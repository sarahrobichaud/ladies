use crate::{
    action::{Action, GameError},
    state::GameState,
};

pub fn step(state: &GameState, action: Action) -> Result<GameState, GameError> {
    let mut next = state.clone();
    let seat = next.to_act;

    apply(&mut next, seat, action)?;
    advance(&mut next, seat)?;

    Ok(next)
}

fn apply(state: &mut GameState, seat: usize, action: Action) -> Result<&GameState, GameError> {
    let player = &mut state.players[seat];

    let mut done = || state.needs_action[seat] = false;

    match action {
        Action::Check => {
            if player.bet != state.current_bet {
                return Err(GameError::IllegalAction {
                    reason: "Cannot check when facing a bet",
                });
            }

            done();
        }
        Action::Call => {
            let owed = state.current_bet - player.bet;
            if owed == 0 {
                return Err(GameError::IllegalAction {
                    reason: "Nothing to call, check instead!",
                });
            }
            player.post(owed);
            done();
        }
    }

    Ok(state)
}

fn advance(mut state: &mut GameState, seat: usize) -> Result<&GameState, GameError> {
    Ok(state)
}
