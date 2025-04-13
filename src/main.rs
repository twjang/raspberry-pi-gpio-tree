pub mod lightctrl;

use std::thread;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::select;
use tokio_util::sync::CancellationToken;

use tokio_websockets::{Message, Error, ServerBuilder};

use lightctrl::light_control_thread;



static LIGHT_CTRL: std::sync::RwLock<Option<lightctrl::LightCtrl>> = std::sync::RwLock::new(None);

async fn handle_client_request(listener: &TcpListener, token: CancellationToken) -> Result<(), Error> {
    let (stream, _saddr) = listener.accept().await?;
    let (_request, mut ws_stream) = ServerBuilder::new()
        .accept(stream)
        .await?;

    tokio::spawn(async move {
        // Just an echo server, really
        while let Some(Ok(msg)) = ws_stream.next().await {
            let mut resp= String::from("unrecognized\n");
            if msg.is_text() {
                if let Some(textmsg) = msg.as_text() {
                    if textmsg.starts_with("set") {
                        let brightness: u32 = textmsg[4..].parse().unwrap();
                        let mut light_ctrl_lck = LIGHT_CTRL.write().unwrap();
                        let light_ctrl = light_ctrl_lck.as_mut().unwrap();
                        match light_ctrl.set(brightness) {
                            Ok(_) => resp = format!("set={}\n", brightness),
                            Err(e) => resp = format!("err={}\n", e),
                        }
                    } else if textmsg.starts_with("get") {
                        let light_ctrl_lck = LIGHT_CTRL.read().unwrap();
                        let light_ctrl = light_ctrl_lck.as_ref().unwrap();
                        match light_ctrl.get() {
                            Ok(brightness) => resp = format!("get={}\n", brightness),
                            Err(e) => resp = format!("err={}\n", e),
                        }
                    } else if textmsg.starts_with("halt") {
                        let mut light_ctrl_lck = LIGHT_CTRL.write().unwrap();
                        let light_ctrl = light_ctrl_lck.as_mut().unwrap();
                        resp = "halted\n".to_string();
                        light_ctrl.halt();
                        token.cancel();
                        break;
                    }
                }
            }
            let resp_msg = Message::text(resp.clone());
            ws_stream.send(resp_msg).await.unwrap();
        }
    });

    Ok::<_, Error>(())
}


async fn main_websocket()->Result<(), Error> {
    let listener = TcpListener::bind("0.0.0.0:3000").await?;
    let token = CancellationToken::new();

   loop {
        select! {
            _ = token.cancelled() => {
                let mut light_ctrl_lck = LIGHT_CTRL.write().unwrap();
                let light_ctrl = light_ctrl_lck.as_mut().unwrap();
                light_ctrl.halt();
            },
            _ = tokio::signal::ctrl_c() => {
                token.cancel();
            },
            Ok(_) = handle_client_request(&listener, token.clone()) => (),
        }
        if token.is_cancelled() {
            break;
        }
    }

    Ok::<_, Error>(())
}



fn main() {
    {
        LIGHT_CTRL.write().unwrap().replace(lightctrl::LightCtrl::new(18, 1000));
    }

    let handler = thread::spawn(|| {
        light_control_thread(&LIGHT_CTRL).unwrap();
    });

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(async {
            main_websocket().await.unwrap();
        });

    handler.join().unwrap();
}
