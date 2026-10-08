use ladies_driver::Session;
use ladies_engine::{Action, Blinds};

fn fold_around(session: &mut Session) {
    session.act(Action::Fold).expect("fold accepted"); // UTG
    session.act(Action::Fold).expect("fold accepted"); // SB — BB wins
}

#[test]
fn three_hands_carry_stacks_and_rotate_the_button_around_the_table() {
    let blinds = Blinds::new(100, 200).expect("good blinds");
    let mut session = Session::new(blinds, &[5000; 3]);

    // Hand 1 — button at seat 0
    session.start_hand(1).expect("hand 1 dealt");
    let hand = session.hand().expect("hand 1 in progress");
    assert_eq!(hand.positions.button, 0);
    assert_eq!(hand.to_act, 0); // UTG
    assert_eq!(hand.stacks(), vec![5000, 4900, 4800]); // blinds posted

    fold_around(&mut session);

    assert_eq!(session.stacks(), vec![5000, 4900, 5100]); // BB (seat 2) wins 300
    assert!(session.hand().is_none(), "hand 1 settled");

    // Hand 2 — button rotated to seat 1, stacks carried forward
    session.start_hand(2).expect("hand 2 dealt");
    let hand = session.hand().expect("hand 2 in progress");
    assert_eq!(hand.positions.button, 1);
    assert_eq!(hand.to_act, 1); // three-handed: the button is UTG
    assert_eq!(hand.stacks(), vec![4800, 4900, 5000]); // carried stacks, new blinds

    fold_around(&mut session);

    assert_eq!(session.stacks(), vec![5100, 4900, 5000]); // BB (seat 0) wins 300
    assert!(session.hand().is_none(), "hand 2 settled");

    // Hand 3 — button rotated to seat 2
    session.start_hand(3).expect("hand 3 dealt");
    let hand = session.hand().expect("hand 3 in progress");
    assert_eq!(hand.positions.button, 2);
    assert_eq!(hand.to_act, 2);
    assert_eq!(hand.stacks(), vec![5000, 4700, 5000]); // carried stacks, new blinds

    fold_around(&mut session);

    assert_eq!(session.stacks(), vec![5000, 5000, 5000]); // BB (seat 1) wins 300 — full circle
    assert!(session.hand().is_none(), "hand 3 settled");

    // conservation: three rounds of blinds, one win each — nobody gained or lost
    assert_eq!(session.stacks().iter().sum::<u64>(), 15_000);
}
