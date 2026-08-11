use std::sync::RwLock;
use std::time::Duration;

use rppal::pwm::{Channel, Polarity, Pwm};

use crate::logging;

pub const MAX_BRIGHTNESS: u32 = 1000;

pub struct LightCtrl {
    pub brigntness: u32,
    pub channel: Channel,
    pub period: u32, // in microseconds
    pub exit: bool,
}

impl LightCtrl {
    pub fn new(channel: Channel, period: u32) -> Self {
        LightCtrl {
            brigntness: 0,
            channel,
            period,
            exit: false,
        }
    }

    pub fn set(&mut self, brightness: u32) -> Result<(), String> {
        if self.exit {
            return Err("Already halted".to_string());
        }

        if brightness <= MAX_BRIGHTNESS {
            self.brigntness = brightness;
            Ok(())
        } else {
            return Err(format!(
                "Brightness value {brightness} is out of range (0-{MAX_BRIGHTNESS})"
            ));
        }
    }

    pub fn get(&self) -> Result<u32, String> {
        if self.exit {
            return Err("Already halted".to_string());
        }

        Ok(self.brigntness)
    }

    pub fn halt(&mut self) {
        self.exit = true;
    }
}

pub fn light_control_thread(ctrllck: &RwLock<Option<LightCtrl>>) -> Result<(), String> {
    let (channel, period, mut brightness) = {
        let light_ctrl_lck = ctrllck.read().unwrap();
        let light_ctrl = light_ctrl_lck.as_ref().unwrap();
        (light_ctrl.channel, light_ctrl.period, light_ctrl.brigntness)
    };

    let pwm = Pwm::with_period(
        channel,
        Duration::from_micros(period as u64),
        Duration::from_micros(
            (period as u64 * brightness.min(MAX_BRIGHTNESS) as u64) / MAX_BRIGHTNESS as u64,
        ),
        Polarity::Normal,
        true,
    )
    .map_err(|error| format!("Failed to initialize PWM channel {channel}: {error}"))?;

    logging::info(format_args!(
        "pwm_started channel={channel} period_us={period} brightness={brightness}"
    ));

    loop {
        let new_brightness = {
            let light_ctrl_lck = ctrllck.read().unwrap();
            let light_ctrl = light_ctrl_lck.as_ref().unwrap();
            if light_ctrl.exit {
                break;
            }
            light_ctrl.brigntness
        };

        if new_brightness != brightness {
            brightness = new_brightness;
            pwm.set_duty_cycle(brightness as f64 / MAX_BRIGHTNESS as f64)
                .map_err(|error| format!("Failed to set PWM duty cycle: {error}"))?;
        }

        std::thread::sleep(Duration::from_micros(period as u64));
    }

    pwm.disable()
        .map_err(|error| format!("Failed to disable PWM channel {channel}: {error}"))?;
    logging::info(format_args!("pwm_stopped channel={channel}"));

    Ok(())
}
