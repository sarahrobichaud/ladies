use crate::Chips;

pub enum Action {
    Fold,
    Call,
    Check,
    Raise { to: Chips },
}
