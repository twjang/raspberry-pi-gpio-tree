pub mod lightctrl;

mod logging;

use std::io;
use std::net::SocketAddr;
use std::thread;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::select;
use tokio_util::sync::CancellationToken;
use tokio_websockets::{Message, ServerBuilder};

use lightctrl::light_control_thread;

const LISTEN_ADDRESS: &str = "0.0.0.0:3000";
const MAX_HTTP_HEADER_SIZE: usize = 8 * 1024;
const INDEX_HTML: &str = include_str!("../static/index.html");

static LIGHT_CTRL: std::sync::RwLock<Option<lightctrl::LightCtrl>> = std::sync::RwLock::new(None);

async fn request_is_websocket(stream: &TcpStream) -> io::Result<bool> {
    let mut header = [0_u8; MAX_HTTP_HEADER_SIZE];

    loop {
        let bytes_read = stream.peek(&mut header).await?;
        if bytes_read == 0 {
            return Ok(false);
        }

        let request = &header[..bytes_read];
        if request.windows(4).any(|window| window == b"\r\n\r\n") || bytes_read == header.len() {
            let request = String::from_utf8_lossy(request).to_ascii_lowercase();
            return Ok(request.contains("\r\nupgrade: websocket"));
        }

        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

async fn read_http_request(stream: &mut TcpStream) -> io::Result<String> {
    let mut request = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];

    while request.len() < MAX_HTTP_HEADER_SIZE {
        let bytes_read = stream.read(&mut chunk).await?;
        if bytes_read == 0 {
            break;
        }

        request.extend_from_slice(&chunk[..bytes_read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    Ok(String::from_utf8_lossy(&request).into_owned())
}

async fn write_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> io::Result<()> {
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\n\r\n",
        body.len()
    );

    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.shutdown().await
}

async fn serve_http(mut stream: TcpStream, peer: SocketAddr) -> io::Result<()> {
    let request = read_http_request(&mut stream).await?;
    let request_line = request.lines().next().unwrap_or_default();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let path = parts.next().unwrap_or_default();

    logging::info(format_args!(
        "http_request peer={peer} method={method} path={path}"
    ));

    match (method, path) {
        ("GET", "/" | "/index.html") => {
            write_http_response(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                INDEX_HTML.as_bytes(),
            )
            .await
        }
        ("GET", "/favicon.ico") => {
            write_http_response(&mut stream, "204 No Content", "image/x-icon", b"").await
        }
        _ => {
            logging::warn(format_args!(
                "http_not_found peer={peer} method={method} path={path}"
            ));
            write_http_response(
                &mut stream,
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"Not found\n",
            )
            .await
        }
    }
}

fn handle_command(command: &str, peer: SocketAddr, token: &CancellationToken) -> String {
    let command = command.trim();

    if let Some(value) = command.strip_prefix("set ") {
        let brightness = match value.parse::<u32>() {
            Ok(brightness) => brightness,
            Err(error) => {
                logging::warn(format_args!(
                    "invalid_brightness peer={peer} value={value:?} error={error}"
                ));
                return "err=brightness must be an integer\n".to_string();
            }
        };

        let mut light_ctrl_lck = LIGHT_CTRL.write().unwrap();
        let Some(light_ctrl) = light_ctrl_lck.as_mut() else {
            logging::error(format_args!("light_controller_unavailable peer={peer}"));
            return "err=light controller unavailable\n".to_string();
        };

        match light_ctrl.set(brightness) {
            Ok(()) => {
                logging::info(format_args!(
                    "brightness_set peer={peer} value={brightness}"
                ));
                format!("set={brightness}\n")
            }
            Err(error) => {
                logging::warn(format_args!(
                    "brightness_rejected peer={peer} value={brightness} error={error:?}"
                ));
                format!("err={error}\n")
            }
        }
    } else if command == "get" {
        let light_ctrl_lck = LIGHT_CTRL.read().unwrap();
        let Some(light_ctrl) = light_ctrl_lck.as_ref() else {
            logging::error(format_args!("light_controller_unavailable peer={peer}"));
            return "err=light controller unavailable\n".to_string();
        };

        match light_ctrl.get() {
            Ok(brightness) => {
                logging::info(format_args!(
                    "brightness_read peer={peer} value={brightness}"
                ));
                format!("get={brightness}\n")
            }
            Err(error) => format!("err={error}\n"),
        }
    } else if command == "halt" {
        logging::warn(format_args!("halt_requested peer={peer}"));
        token.cancel();
        "halted\n".to_string()
    } else {
        logging::warn(format_args!(
            "unknown_command peer={peer} command={command:?}"
        ));
        "err=unrecognized command\n".to_string()
    }
}

async fn serve_websocket(stream: TcpStream, peer: SocketAddr, token: CancellationToken) {
    let (request, mut websocket) = match ServerBuilder::new().accept(stream).await {
        Ok(connection) => connection,
        Err(error) => {
            logging::warn(format_args!(
                "websocket_handshake_failed peer={peer} error={error}"
            ));
            return;
        }
    };

    logging::info(format_args!(
        "websocket_connected peer={peer} path={}",
        request.uri().path()
    ));

    loop {
        select! {
            _ = token.cancelled() => break,
            message = websocket.next() => {
                let Some(message) = message else {
                    break;
                };

                let message = match message {
                    Ok(message) => message,
                    Err(error) => {
                        logging::warn(format_args!(
                            "websocket_receive_failed peer={peer} error={error}"
                        ));
                        break;
                    }
                };

                if message.is_close() {
                    break;
                }

                if message.is_ping() {
                    if let Err(error) = websocket
                        .send(Message::pong(message.into_payload()))
                        .await
                    {
                        logging::warn(format_args!(
                            "websocket_pong_failed peer={peer} error={error}"
                        ));
                        break;
                    }
                    continue;
                }

                if message.is_pong() {
                    continue;
                }

                let response = if let Some(command) = message.as_text() {
                    handle_command(command, peer, &token)
                } else {
                    logging::warn(format_args!("non_text_message peer={peer}"));
                    "err=text commands only\n".to_string()
                };

                if let Err(error) = websocket.send(Message::text(response)).await {
                    logging::warn(format_args!(
                        "websocket_send_failed peer={peer} error={error}"
                    ));
                    break;
                }
            }
        }
    }

    logging::info(format_args!("websocket_disconnected peer={peer}"));
}

async fn handle_connection(stream: TcpStream, peer: SocketAddr, token: CancellationToken) {
    let request_type =
        match tokio::time::timeout(Duration::from_secs(5), request_is_websocket(&stream)).await {
            Ok(request_type) => request_type,
            Err(_) => {
                logging::warn(format_args!("connection_header_timeout peer={peer}"));
                return;
            }
        };

    match request_type {
        Ok(true) => serve_websocket(stream, peer, token).await,
        Ok(false) => {
            if let Err(error) = serve_http(stream, peer).await {
                logging::warn(format_args!(
                    "http_connection_failed peer={peer} error={error}"
                ));
            }
        }
        Err(error) => logging::warn(format_args!(
            "connection_detection_failed peer={peer} error={error}"
        )),
    }
}

fn halt_light_controller() {
    let mut light_ctrl_lck = LIGHT_CTRL.write().unwrap();
    if let Some(light_ctrl) = light_ctrl_lck.as_mut() {
        light_ctrl.halt();
    }
}

async fn main_server() -> io::Result<()> {
    let listener = TcpListener::bind(LISTEN_ADDRESS).await?;
    let token = CancellationToken::new();

    logging::info(format_args!(
        "server_started address={LISTEN_ADDRESS} ui=http://{LISTEN_ADDRESS}/"
    ));

    loop {
        select! {
            _ = token.cancelled() => {
                logging::info(format_args!("shutdown_signal source=websocket"));
                break;
            }
            signal = tokio::signal::ctrl_c() => {
                match signal {
                    Ok(()) => logging::info(format_args!("shutdown_signal source=ctrl_c")),
                    Err(error) => logging::error(format_args!(
                        "shutdown_signal_failed error={error}"
                    )),
                }
                token.cancel();
                break;
            }
            connection = listener.accept() => {
                match connection {
                    Ok((stream, peer)) => {
                        logging::info(format_args!("connection_accepted peer={peer}"));
                        tokio::spawn(handle_connection(stream, peer, token.clone()));
                    }
                    Err(error) => logging::warn(format_args!(
                        "connection_accept_failed error={error}"
                    )),
                }
            }
        }
    }

    halt_light_controller();
    logging::info(format_args!("server_stopped"));
    Ok(())
}

fn main() {
    logging::info(format_args!("application_starting"));

    LIGHT_CTRL
        .write()
        .unwrap()
        .replace(lightctrl::LightCtrl::new(rppal::pwm::Channel::Pwm0, 1000));

    let pwm_thread = thread::spawn(|| {
        if let Err(error) = light_control_thread(&LIGHT_CTRL) {
            logging::error(format_args!("pwm_thread_failed error={error:?}"));
        }
    });

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("failed to create Tokio runtime");

    if let Err(error) = runtime.block_on(main_server()) {
        logging::error(format_args!("server_failed error={error}"));
        halt_light_controller();
    }

    if pwm_thread.join().is_err() {
        logging::error(format_args!("pwm_thread_panicked"));
    }

    logging::info(format_args!("application_stopped"));
}
