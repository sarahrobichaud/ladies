use ladies_core::decks::StandardDeck;

fn main() {
    let mut deck = StandardDeck::new();

    let mut c = 1;
    while let Some(card) = deck.deal() {
        println!("{} - {}", c, card);
        c += 1;
    }
}
