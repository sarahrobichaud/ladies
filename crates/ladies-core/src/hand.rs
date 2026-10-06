pub enum Category {
    HighCard,
    Pair,
    TwoPair,
    ThreeOfAKind,
}

pub enum Hand {
    Hand(&[card; 5], Category),
}
