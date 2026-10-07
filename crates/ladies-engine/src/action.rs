pub enum Action {
    Check,
    Call
}

pub enum GameError {
    IllegalAction {reason: &'static str}
}
