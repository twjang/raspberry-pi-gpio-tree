use std::fmt;

pub fn init() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
}

pub fn info(message: fmt::Arguments<'_>) {
    log::info!("{message}");
}

pub fn debug(message: fmt::Arguments<'_>) {
    log::debug!("{message}");
}

pub fn warn(message: fmt::Arguments<'_>) {
    log::warn!("{message}");
}

pub fn error(message: fmt::Arguments<'_>) {
    log::error!("{message}");
}
