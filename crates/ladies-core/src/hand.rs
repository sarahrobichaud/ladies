use std::{
    fmt::{self, Display},
    str::FromStr,
};

use crate::card::{Card, CardParseErr};

pub const MIN_CARDS: usize = 5;
pub const MAX_CARDS: usize = 7;

/// Five to seven distinct cards, as dealt from a deck.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Hand {
    cards: Vec<Card>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandErr {
    WrongCardCount(usize),
    DuplicateCard(Card),
}

impl Hand {
    pub fn new(cards: Vec<Card>) -> Result<Self, HandErr> {
        if !(MIN_CARDS..=MAX_CARDS).contains(&cards.len()) {
            return Err(HandErr::WrongCardCount(cards.len()));
        }

        for (i, card) in cards.iter().enumerate() {
            if cards[i + 1..].contains(card) {
                return Err(HandErr::DuplicateCard(*card));
            }
        }

        Ok(Self { cards })
    }

    pub fn cards(&self) -> &[Card] {
        &self.cards
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandParseErr {
    WrongCardCount(usize),
    BadCard(usize, CardParseErr),
    DuplicateCard(Card),
}

impl From<HandErr> for HandParseErr {
    fn from(err: HandErr) -> Self {
        match err {
            HandErr::WrongCardCount(n) => HandParseErr::WrongCardCount(n),
            HandErr::DuplicateCard(card) => HandParseErr::DuplicateCard(card),
        }
    }
}

impl FromStr for Hand {
    type Err = HandParseErr;

    /// Parses space-separated cards, e.g. `"Ah Kd Qc Js Ts"`.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut cards = Vec::new();
        for (i, token) in s.split_whitespace().enumerate() {
            let card = Card::from_str(token).map_err(|err| HandParseErr::BadCard(i, err))?;
            cards.push(card);
        }

        Ok(Hand::new(cards)?)
    }
}

impl Display for Hand {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (i, card) in self.cards.iter().enumerate() {
            if i > 0 {
                f.write_str(" ")?;
            }
            write!(f, "{card}")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use crate::card::Card;

    use super::*;

    /// Parses a single card, for precise assertions.
    fn card(s: &str) -> Card {
        Card::from_str(s).unwrap()
    }

    /// Parses space-separated cards, for building hands.
    fn cards(s: &str) -> Vec<Card> {
        s.split_whitespace().map(card).collect()
    }

    #[test]
    fn hands_accept_five_distinct_cards() {
        let cards = cards("Ah Kd Qc Js Ts");

        let hand = Hand::new(cards.clone()).unwrap();

        assert_eq!(hand.cards(), &cards[..]);
    }

    #[test]
    fn hands_accept_seven_distinct_cards() {
        let cards = cards("Ah Kd Qc Js Ts 9c 8d");

        let hand = Hand::new(cards.clone()).unwrap();

        assert_eq!(hand.cards(), &cards[..]);
    }

    #[test]
    fn hands_reject_duplicate_cards() {
        let cards = cards("Ah Ah Qc Js Ts");

        assert_eq!(Hand::new(cards), Err(HandErr::DuplicateCard(card("Ah"))));
    }

    #[test]
    fn hands_reject_wrong_card_counts() {
        assert_eq!(
            Hand::new(cards("Ah Kd Qc Js")),
            Err(HandErr::WrongCardCount(4))
        );
        assert_eq!(
            Hand::new(cards("Ah Kd Qc Js Ts 9c 8d 7h")),
            Err(HandErr::WrongCardCount(8))
        );
    }

    #[test]
    fn hands_parse_from_space_separated_cards() {
        let hand = Hand::from_str("Ah Kd Qc Js Ts").unwrap();

        let expected = [card("Ah"), card("Kd"), card("Qc"), card("Js"), card("Ts")];

        assert_eq!(hand.cards(), &expected);
    }

    #[test]
    fn hands_parse_seven_cards() {
        let hand = Hand::from_str("Ah Kd Qc Js Ts 9c 8d").unwrap();

        assert_eq!(hand.cards().len(), 7);
        assert_eq!(hand.cards()[6], card("8d"));
    }

    #[test]
    fn hands_parse_rejects_wrong_card_counts() {
        assert_eq!(Hand::from_str(""), Err(HandParseErr::WrongCardCount(0)));
        assert_eq!(
            Hand::from_str("Ah Kd Qc Js"),
            Err(HandParseErr::WrongCardCount(4))
        );
        assert_eq!(
            Hand::from_str("Ah Kd Qc Js Ts 9c 8d 7h"),
            Err(HandParseErr::WrongCardCount(8))
        );
    }

    #[test]
    fn hands_parse_reports_the_bad_card_position() {
        assert_eq!(
            Hand::from_str("Ah Kd xx"),
            Err(HandParseErr::BadCard(2, Card::from_str("xx").unwrap_err()))
        );
    }

    #[test]
    fn hands_parse_rejects_duplicate_cards() {
        assert_eq!(
            Hand::from_str("Ah Ah Qc Js Ts"),
            Err(HandParseErr::DuplicateCard(card("Ah")))
        );
    }

    #[test]
    fn hands_round_trip_through_display() {
        for hand in ["Ah Kd Qc Js Ts", "2c 7h 3d 7d Ks 7s Kd"] {
            let hand = Hand::from_str(hand).unwrap();
            assert_eq!(Hand::from_str(&hand.to_string()), Ok(hand));
        }
    }
}
