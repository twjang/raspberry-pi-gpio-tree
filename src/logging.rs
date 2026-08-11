use std::fmt;
use std::sync::OnceLock;
use std::time::Instant;

static STARTED_AT: OnceLock<Instant> = OnceLock::new();

fn write(level: &str, message: fmt::Arguments<'_>) {
    let elapsed = STARTED_AT.get_or_init(Instant::now).elapsed();
    eprintln!(
        "[{seconds:>6}.{millis:03}] {level:<5} {message}",
        seconds = elapsed.as_secs(),
        millis = elapsed.subsec_millis(),
    );
}

pub fn info(message: fmt::Arguments<'_>) {
    write("INFO", message);
}

pub fn warn(message: fmt::Arguments<'_>) {
    write("WARN", message);
}

pub fn error(message: fmt::Arguments<'_>) {
    write("ERROR", message);
}
