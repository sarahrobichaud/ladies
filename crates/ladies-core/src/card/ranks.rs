use std::{
    fmt::{self, Display},
    str::FromStr,
};

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Rank {
    Two = 2,
    Three = 3,
    Four = 4,
    Five = 5,
    Six = 6,
    Seven = 7,
    Eight = 8,
    Nine = 9,
    Ten = 10,
    Jack = 11,
    Queen = 12,
    King = 13,
    Ace = 14,
}

pub const RANKS: [Rank; 13] = [
    Rank::Two,
    Rank::Three,
    Rank::Four,
    Rank::Five,
    Rank::Six,
    Rank::Seven,
    Rank::Eight,
    Rank::Nine,
    Rank::Ten,
    Rank::Jack,
    Rank::Queen,
    Rank::King,
    Rank::Ace,
];

impl Rank {
    pub fn from_index(i: usize) -> Option<Rank> {
        RANKS.get(i).copied()
    }

    pub fn to_char(self) -> char {
        match self {
            Rank::Two => '2',
            Rank::Three => '3',
            Rank::Four => '4',
            Rank::Five => '5',
            Rank::Six => '6',
            Rank::Seven => '7',
            Rank::Eight => '8',
            Rank::Nine => '9',
            Rank::Ten => 'T',
            Rank::Jack => 'J',
            Rank::Queen => 'Q',
            Rank::King => 'K',
            Rank::Ace => 'A',
        }
    }
}

impl Display for Rank {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_char())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RankParseErr {
    WrongLength(usize),
    UnknownChar(char),
}

impl FromStr for Rank {
    type Err = RankParseErr;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut chars = s.chars();
        match (chars.next(), chars.next()) {
            (Some(c), None) => match c {
                '2' => Ok(Rank::Two),
                '3' => Ok(Rank::Three),
                '4' => Ok(Rank::Four),
                '5' => Ok(Rank::Five),
                '6' => Ok(Rank::Six),
                '7' => Ok(Rank::Seven),
                '8' => Ok(Rank::Eight),
                '9' => Ok(Rank::Nine),
                'T' => Ok(Rank::Ten),
                'J' => Ok(Rank::Jack),
                'Q' => Ok(Rank::Queen),
                'K' => Ok(Rank::King),
                'A' => Ok(Rank::Ace),
                _ => Err(RankParseErr::UnknownChar(c)),
            },
            _ => Err(RankParseErr::WrongLength(s.chars().count())),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use crate::card::ranks::{RANKS, Rank, RankParseErr};

    const EXPECTED_CHARS: [char; 13] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

    #[test]
    fn ranks_have_correct_char_mappings() {
        for (rank, expected) in RANKS.iter().zip(EXPECTED_CHARS) {
            assert_eq!(rank.to_char(), expected);
        }
    }

    #[test]
    fn ranks_display_as_expected_chars() {
        for (rank, expected) in RANKS.iter().zip(EXPECTED_CHARS) {
            assert_eq!(rank.to_string(), expected.to_string());
        }
    }

    #[test]
    fn ranks_parse_from_their_char() {
        for (rank, expected) in RANKS.iter().zip(EXPECTED_CHARS) {
            assert_eq!(Rank::from_str(&expected.to_string()), Ok(*rank));
        }
    }

    #[test]
    fn ranks_parse_rejects_wrong_length() {
        assert_eq!(Rank::from_str(""), Err(RankParseErr::WrongLength(0)));
        assert_eq!(Rank::from_str("22"), Err(RankParseErr::WrongLength(2)));
    }

    #[test]
    fn ranks_parse_rejects_unknown_char() {
        assert_eq!(Rank::from_str("x"), Err(RankParseErr::UnknownChar('x')));
        assert_eq!(Rank::from_str("1"), Err(RankParseErr::UnknownChar('1')));
        assert_eq!(Rank::from_str("a"), Err(RankParseErr::UnknownChar('a')));
    }

    #[test]
    fn ranks_round_trip_through_display() {
        for rank in RANKS {
            assert_eq!(Rank::from_str(&rank.to_string()), Ok(rank));
        }
    }
}
