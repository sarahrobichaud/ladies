use std::{
    fmt::{self, Display},
    str::FromStr,
};

use crate::card::{Card, CardParseErr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Hand {
    cards: [Card; 5],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandErr {
    DuplicateCard(Card),
}

impl Hand {
    pub fn new(cards: [Card; 5]) -> Result<Self, HandErr> {
        for (i, card) in cards.iter().enumerate() {
            if cards[i + 1..].contains(card) {
                return Err(HandErr::DuplicateCard(*card));
            }
        }
        Ok(Self { cards })
    }

    pub fn cards(&self) -> &[Card; 5] {
        &self.cards
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HandParseErr {
    WrongLength(usize),
    BadCard(usize, CardParseErr),
    DuplicateCard(Card),
}

impl FromStr for Hand {
    type Err = HandParseErr;

    /// Parses ten rank/suit chars
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let chars: Vec<char> = s.chars().collect();
        if chars.len() != 10 {
            return Err(HandParseErr::WrongLength(chars.len()));
        }

        let mut cards = Vec::with_capacity(5);
        for (i, pair) in chars.chunks(2).enumerate() {
            let card_str: String = pair.iter().collect();
            let card = Card::from_str(&card_str).map_err(|err| HandParseErr::BadCard(i, err))?;
            cards.push(card);
        }

        let cards: [Card; 5] = cards.try_into().unwrap();
        Hand::new(cards).map_err(|HandErr::DuplicateCard(card)| HandParseErr::DuplicateCard(card))
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

    use crate::card::{Card, Rank, Suit};

    use super::*;

    fn card(rank: Rank, suit: Suit) -> Card {
        Card { rank, suit }
    }

    #[test]
    fn hands_accept_five_distinct_cards() {
        let cards = [
            card(Rank::Ace, Suit::Heart),
            card(Rank::King, Suit::Diamond),
            card(Rank::Queen, Suit::Club),
            card(Rank::Jack, Suit::Spade),
            card(Rank::Ten, Suit::Heart),
        ];

        let hand = Hand::new(cards).unwrap();

        assert_eq!(hand.cards(), &cards);
    }

    #[test]
    fn hands_reject_duplicate_cards() {
        let cards = [
            card(Rank::Ace, Suit::Heart),
            card(Rank::Ace, Suit::Heart),
            card(Rank::Queen, Suit::Club),
            card(Rank::Jack, Suit::Spade),
            card(Rank::Ten, Suit::Heart),
        ];

        assert_eq!(
            Hand::new(cards),
            Err(HandErr::DuplicateCard(card(Rank::Ace, Suit::Heart)))
        );
    }

    #[test]
    fn hands_parse_from_ten_chars() {
        let hand = Hand::from_str("AhKdQcJsTs").unwrap();

        let expected = [
            card(Rank::Ace, Suit::Heart),
            card(Rank::King, Suit::Diamond),
            card(Rank::Queen, Suit::Club),
            card(Rank::Jack, Suit::Spade),
            card(Rank::Ten, Suit::Spade),
        ];

        assert_eq!(hand.cards(), &expected);
    }

    #[test]
    fn hands_parse_rejects_wrong_length() {
        assert_eq!(Hand::from_str(""), Err(HandParseErr::WrongLength(0)));
        assert_eq!(Hand::from_str("AhKdQcJsT"), Err(HandParseErr::WrongLength(9)));
        assert_eq!(
            Hand::from_str("AhKdQcJsTsXx"),
            Err(HandParseErr::WrongLength(12))
        );
    }

    #[test]
    fn hands_parse_reports_the_bad_card_position() {
        assert_eq!(
            Hand::from_str("AhKmQcJs3d"),
            Err(HandParseErr::BadCard(
                1,
                CardParseErr::BadSuit(Suit::from_str("m").unwrap_err())
            ))
        );
        assert_eq!(
            Hand::from_str("AhKdQcJsxx"),
            Err(HandParseErr::BadCard(
                4,
                CardParseErr::BadRank(Rank::from_str("x").unwrap_err())
            ))
        );
    }

    #[test]
    fn hands_parse_rejects_duplicate_cards() {
        assert_eq!(
            Hand::from_str("AhAhQcJsTs"),
            Err(HandParseErr::DuplicateCard(card(Rank::Ace, Suit::Heart)))
        );
    }

    #[test]
    fn hands_round_trip_through_display() {
        let hand = Hand::from_str("AhKdQcJsTs").unwrap();

        assert_eq!(hand.to_string(), "Ah Kd Qc Js Ts");
        assert_eq!(Hand::from_str(&hand.to_string().replace(' ', "")), Ok(hand));
    }
}
