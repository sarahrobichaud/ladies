use std::{
    fmt::{self, Display},
    str::FromStr,
};

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Hash)]
pub enum Suit {
    Heart,
    Club,
    Spade,
    Diamond,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Rank {
    Two,
    Three,
    Four,
    Five,
    Six,
    Seven,
    Eight,
    Nine,
    Ten,
    Jack,
    Queen,
    King,
    Ace,
}

pub const SUITS: [Suit; 4] = [Suit::Heart, Suit::Club, Suit::Spade, Suit::Diamond];
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Card {
    pub rank: Rank,
    pub suit: Suit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardParseErr {
    WrongLenght(usize),
}

impl Display for Card {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Hello")
    }
}

impl FromStr for Card {
    type Err = CardParseErr;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if s.len() != 2 {
            return Err(CardParseErr::WrongLenght(s.len()));
        }

        Ok(Card {
            rank: Rank::Ace,
            suit: Suit::Diamond,
        })
    }
}
