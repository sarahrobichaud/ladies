use crate::state::Chips;

pub struct Blinds {
    pub(super) small: Chips,
    pub(super) big: Chips,
}

impl Blinds {
    pub fn new(small: Chips, big: Chips) -> Result<Self, &'static str> {
        if small > big {
            return Err("Small blind value must be smaller than big blind value.");
        }

        Ok(Self { small, big })
    }
}
