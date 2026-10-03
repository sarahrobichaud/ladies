
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Suit {
    Heart,
    Club,
    Spade,
    Diamond
}

#[derive(Debug)]
pub struct Card {
    value: u8,
    suit: Suit
}

impl Card {
    pub fn create(value: u8, suit: Suit) -> Self{
        Self {
            value,suit
        }
    }

    pub fn suit(&self) -> Suit {
        self.suit
    }

    pub fn value(&self) -> u8 {
        self.value
    }

    pub fn key(&self) -> (u8, Suit) {
        (self.value, self.suit)
    }
}
