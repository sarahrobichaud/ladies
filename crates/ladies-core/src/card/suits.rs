use std::{fmt::{self, Display}, str::FromStr};

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Hash)]
pub enum Suit {
    Heart,
    Club,
    Spade,
    Diamond,
}

impl Suit {
    pub fn to_char(self) -> char {
        match self {
            Suit::Heart => 'h',
            Suit::Club => 'c',
            Suit::Diamond => 'd',
            Suit::Spade => 's',
        }
    }
}

impl Display for Suit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_char())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuitParseErr {
    WrongLength(usize),
    UnknownChar(char),
}

impl FromStr for Suit {
    type Err = SuitParseErr;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut chars = s.chars();
        match (chars.next(), chars.next()) {
            (Some(c), None) => match c {
                'h' => Ok(Suit::Heart),
                'c' => Ok(Suit::Club),
                's' => Ok(Suit::Spade),
                'd' => Ok(Suit::Diamond),
                _ => Err(SuitParseErr::UnknownChar(c)),
            },
            _ => Err(SuitParseErr::WrongLength(s.chars().count())),
        }
    }
}

pub const SUITS: [Suit; 4] = [Suit::Heart, Suit::Club, Suit::Spade, Suit::Diamond];


#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use crate::card::suits::{SUITS, Suit, SuitParseErr};

    #[test]
    fn suits_have_correct_char_mappings() {
        assert_eq!(Suit::Club.to_char(), 'c');
        assert_eq!(Suit::Heart.to_char(), 'h');
        assert_eq!(Suit::Spade.to_char(), 's');
        assert_eq!(Suit::Diamond.to_char(), 'd');
    }

    #[test]
    fn suits_display_as_single_lowercase_char() {
        assert_eq!(Suit::Heart.to_string(), "h");
        assert_eq!(Suit::Club.to_string(), "c");
        assert_eq!(Suit::Spade.to_string(), "s");
        assert_eq!(Suit::Diamond.to_string(), "d");
    }

    #[test]
    fn suits_parse_from_their_char() {
        assert_eq!(Suit::from_str("h"), Ok(Suit::Heart));
        assert_eq!(Suit::from_str("c"), Ok(Suit::Club));
        assert_eq!(Suit::from_str("s"), Ok(Suit::Spade));
        assert_eq!(Suit::from_str("d"), Ok(Suit::Diamond));
    }

    #[test]
    fn suits_parse_rejects_wrong_length() {
        assert_eq!(Suit::from_str(""), Err(SuitParseErr::WrongLength(0)));
        assert_eq!(Suit::from_str("hh"), Err(SuitParseErr::WrongLength(2)));
    }

    #[test]
    fn suits_parse_rejects_unknown_char() {
        assert_eq!(Suit::from_str("x"), Err(SuitParseErr::UnknownChar('x')));
        assert_eq!(Suit::from_str("H"), Err(SuitParseErr::UnknownChar('H')));
    }

    #[test]
    fn suits_round_trip_through_display() {
        for suit in SUITS {
            assert_eq!(Suit::from_str(&suit.to_string()), Ok(suit));
        }
    }
}
