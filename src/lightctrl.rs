use std::sync::RwLock;

use rppal::gpio::Gpio;

pub struct LightCtrl{
    pub brigntness: u32,
    pub pin_id: u8,
    pub period: u32, // in microseconds
    pub exit: bool,
}

impl LightCtrl {
    pub fn new(pin_id: u8, period: u32) -> Self {
        LightCtrl {
            brigntness: 0,
            pin_id,
            period,
            exit: false,
        }
    }

    pub fn set(&mut self, brightness: u32) -> Result<(), String> {
        if self.exit {
            return Err("Already halted".to_string());
        }

        if brightness <= 100 {
            self.brigntness = brightness;
            Ok(())
        } else {
            return Err(format!("Brightness value {} is out of range (0-100)", brightness));
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

pub fn light_control_thread(ctrllck: &RwLock<Option<LightCtrl>>)-> Result<(), String> {
    let pin_id = {
        let light_ctrl_lck = ctrllck.read().unwrap();
        let light_ctrl = light_ctrl_lck.as_ref().unwrap();
        light_ctrl.pin_id
    };

    let gpio = Gpio::new().unwrap();
    let mut pin = gpio.get(pin_id).unwrap().into_output();
    
    let mut period_64;
    let mut brightness_64;
    loop {
        {
            let light_ctrl_lck = ctrllck.read().unwrap();
            let light_ctrl = light_ctrl_lck.as_ref().unwrap();
            if light_ctrl.exit {
                break;
            }
            period_64 = light_ctrl.period as u64;
            brightness_64 = light_ctrl.brigntness as u64;
        }
        let high_time: u64 = std::cmp::min( (period_64 * brightness_64) / 100, period_64);
        let low_time: u64 = period_64 - high_time;

        pin.set_high();
        std::thread::sleep(std::time::Duration::from_micros(high_time));
        pin.set_low();
        std::thread::sleep(std::time::Duration::from_micros(low_time));
    }

    Ok(())
}