use std::fmt;

use crate::state::Chips;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlindsError {
    ZeroBlind,
    SmallExceedsBig,
}

impl fmt::Display for BlindsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ZeroBlind => write!(f, "Blind values must be greater than zero."),
            Self::SmallExceedsBig => {
                write!(f, "Small blind value must be smaller than big blind value.")
            }
        }
    }
}

impl std::error::Error for BlindsError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Blinds {
    pub(super) small: Chips,
    pub(super) big: Chips,
}

impl Blinds {
    pub fn new(small: Chips, big: Chips) -> Result<Self, BlindsError> {
        if small == 0 || big == 0 {
            return Err(BlindsError::ZeroBlind);
        }

        if small > big {
            return Err(BlindsError::SmallExceedsBig);
        }

        Ok(Self { small, big })
    }
}

#[cfg(test)]
mod tests {
    use crate::state::Blinds;
    use crate::state::blinds::BlindsError;

    #[test]
    fn small_blind_must_be_smaller_than_big_blind() {
        assert!(Blinds::new(10, 20).is_ok());
        assert!(Blinds::new(10, 10).is_ok());

        assert_eq!(Blinds::new(20, 10), Err(BlindsError::SmallExceedsBig));
    }

    #[test]
    fn blinds_must_be_greater_than_zero() {
        assert_eq!(Blinds::new(0, 10), Err(BlindsError::ZeroBlind));
        assert_eq!(Blinds::new(10, 0), Err(BlindsError::ZeroBlind));
        assert_eq!(Blinds::new(0, 0), Err(BlindsError::ZeroBlind));
    }
}
