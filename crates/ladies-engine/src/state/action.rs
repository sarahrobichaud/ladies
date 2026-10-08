pub enum Action {
    Fold,
}

#[derive(Debug)]
pub enum GameError {
    IllegalAction { reason: &'static str },
}
