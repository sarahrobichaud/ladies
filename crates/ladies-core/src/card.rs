use std::{
    fmt::{self, Display},
    str::FromStr,
};

pub mod ranks;
pub mod suits;

pub use crate::card::{
    ranks::{Rank, RankParseErr},
    suits::{Suit, SuitParseErr},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Card {
    pub rank: Rank,
    pub suit: Suit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardParseErr {
    WrongLength(usize),
    BadRank(RankParseErr),
    BadSuit(SuitParseErr),
}

impl Display for Card {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.rank.to_char(), self.suit.to_char())
    }
}

impl FromStr for Card {
    type Err = CardParseErr;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut chars = s.chars();
        match (chars.next(), chars.next(), chars.next()) {
            (Some(r), Some(u), None) => {
                let rank = Rank::from_str(&r.to_string()).map_err(CardParseErr::BadRank)?;
                let suit = Suit::from_str(&u.to_string()).map_err(CardParseErr::BadSuit)?;
                Ok(Card { rank, suit })
            }
            _ => Err(CardParseErr::WrongLength(s.chars().count())),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use crate::card::{
        Card, CardParseErr,
        ranks::{RANKS, Rank, RankParseErr},
        suits::{SUITS, Suit, SuitParseErr},
    };

    #[test]
    fn cards_parse_from_rank_and_suit_chars() {
        assert_eq!(
            Card::from_str("2h"),
            Ok(Card {
                rank: Rank::Two,
                suit: Suit::Heart
            })
        );
        assert_eq!(
            Card::from_str("Ts"),
            Ok(Card {
                rank: Rank::Ten,
                suit: Suit::Spade
            })
        );
        assert_eq!(
            Card::from_str("Ad"),
            Ok(Card {
                rank: Rank::Ace,
                suit: Suit::Diamond
            })
        );
    }

    #[test]
    fn cards_round_trip_through_display() {
        for rank in RANKS {
            for suit in SUITS {
                let card = Card { rank, suit };
                assert_eq!(Card::from_str(&card.to_string()), Ok(card));
            }
        }
    }

    #[test]
    fn cards_parse_rejects_wrong_length() {
        assert_eq!(Card::from_str(""), Err(CardParseErr::WrongLength(0)));
        assert_eq!(Card::from_str("2"), Err(CardParseErr::WrongLength(1)));
        assert_eq!(Card::from_str("2hh"), Err(CardParseErr::WrongLength(3)));
    }

    #[test]
    fn cards_parse_rejects_bad_rank() {
        assert_eq!(
            Card::from_str("xh"),
            Err(CardParseErr::BadRank(RankParseErr::UnknownChar('x')))
        );
        assert_eq!(
            Card::from_str("1h"),
            Err(CardParseErr::BadRank(RankParseErr::UnknownChar('1')))
        );
    }

    #[test]
    fn cards_parse_rejects_bad_suit() {
        assert_eq!(
            Card::from_str("2x"),
            Err(CardParseErr::BadSuit(SuitParseErr::UnknownChar('x')))
        );
        assert_eq!(
            Card::from_str("2H"),
            Err(CardParseErr::BadSuit(SuitParseErr::UnknownChar('H')))
        );
    }
}
