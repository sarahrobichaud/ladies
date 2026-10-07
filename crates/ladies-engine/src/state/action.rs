pub enum Action {
    Play,
}

pub enum GameError {
    IllegalAction { reason: &'static str },
}
