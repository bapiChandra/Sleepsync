#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env, String};

const DAY_IN_SECONDS: u64 = 86_400;
const WEEK_IN_SECONDS: u64 = 604_800;

pub const MIN_SESSION_MINUTES: u32 = 5;
pub const MAX_SESSION_MINUTES: u32 = 480;
pub const MIN_GOAL_MINUTES: u32 = 30;
pub const MAX_GOAL_MINUTES: u32 = 5_000;

#[derive(Clone)]
#[contracttype]
pub struct SleepProfile {
    pub display_name: String,
    pub created_at: u64,
    pub last_sleep_day: u64,
    pub active_week: u64,
    pub weekly_goal_minutes: u32,
    pub total_minutes: u32,
    pub minutes_this_week: u32,
    pub session_count: u32,
    pub on_time_session_count: u32,
    pub current_streak: u32,
    pub weekly_goal_reached: bool,
}

#[derive(Clone)]
#[contracttype]
pub struct LeaderboardEntry {
    pub sleeper: Address,
    pub display_name: String,
    pub recovery_score: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct SleepSession {
    pub sleep_type: String,
    pub minutes_slept: u32,
    pub slept_on_time: bool,
    pub timestamp: u64,
    pub streak_after_log: u32,
    pub recovery_score_after_log: u32,
}

#[derive(Clone)]
#[contracttype]
pub struct SleepDashboard {
    pub display_name: String,
    pub weekly_goal_minutes: u32,
    pub total_minutes: u32,
    pub minutes_this_week: u32,
    pub session_count: u32,
    pub on_time_session_count: u32,
    pub current_streak: u32,
    pub created_at: u64,
    pub goal_reached_this_week: bool,
    pub consistency_score: u32,
    pub recovery_score: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct ProfileSaved {
    #[topic]
    pub sleeper: Address,
    pub display_name: String,
    pub weekly_goal_minutes: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct WeeklyGoalUpdated {
    #[topic]
    pub sleeper: Address,
    pub weekly_goal_minutes: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct SleepLogged {
    #[topic]
    pub sleeper: Address,
    pub sleep_type: String,
    pub minutes_slept: u32,
    pub slept_on_time: bool,
    pub minutes_this_week: u32,
    pub current_streak: u32,
    pub recovery_score: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct WeeklyGoalReached {
    #[topic]
    pub sleeper: Address,
    pub weekly_goal_minutes: u32,
    pub minutes_this_week: u32,
    pub recovery_score: u32,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Profile(Address),
    Session(Address, u32),
    Leaderboard,
    RewardContract,
}

mod reward_contract {
    use soroban_sdk::{contractclient, Address, Env};

    #[contractclient(name = "Client")]
    pub trait SleepRewardTrait {
        fn mint(env: Env, to: Address, amount: i128);
    }
}

#[contract]
pub struct SleepSync;

#[contractimpl]
impl SleepSync {
    pub fn set_reward_contract(env: Env, reward_contract: Address) {
        env.storage().persistent().set(&DataKey::RewardContract, &reward_contract);
    }

    pub fn save_profile(env: Env, sleeper: Address, display_name: String, weekly_goal_minutes: u32) {
        sleeper.require_auth();
        validate_display_name(&display_name);
        validate_weekly_goal(weekly_goal_minutes);

        let now = env.ledger().timestamp();
        let current_week = current_week(&env);

        let mut profile = read_profile_optional(&env, &sleeper).unwrap_or(SleepProfile {
            display_name: display_name.clone(),
            created_at: now,
            last_sleep_day: 0,
            active_week: current_week,
            weekly_goal_minutes,
            total_minutes: 0,
            minutes_this_week: 0,
            session_count: 0,
            on_time_session_count: 0,
            current_streak: 0,
            weekly_goal_reached: false,
        });

        sync_week(&mut profile, current_week);
        profile.display_name = display_name.clone();
        profile.weekly_goal_minutes = weekly_goal_minutes;
        profile.weekly_goal_reached = profile.minutes_this_week >= weekly_goal_minutes;

        write_profile(&env, &sleeper, &profile);
        update_leaderboard(&env, sleeper.clone(), profile.display_name.clone(), calculate_recovery_score(&profile));
        ProfileSaved {
            sleeper,
            display_name,
            weekly_goal_minutes,
        }
        .publish(&env);
    }

    pub fn update_weekly_goal(env: Env, sleeper: Address, new_goal_minutes: u32) {
        sleeper.require_auth();
        validate_weekly_goal(new_goal_minutes);

        let mut profile = read_profile_required(&env, &sleeper);
        sync_week(&mut profile, current_week(&env));
        profile.weekly_goal_minutes = new_goal_minutes;
        profile.weekly_goal_reached = profile.minutes_this_week >= new_goal_minutes;

        write_profile(&env, &sleeper, &profile);
        update_leaderboard(&env, sleeper.clone(), profile.display_name.clone(), calculate_recovery_score(&profile));
        WeeklyGoalUpdated {
            sleeper,
            weekly_goal_minutes: new_goal_minutes,
        }
        .publish(&env);
    }

    pub fn log_session(
        env: Env,
        sleeper: Address,
        sleep_type: String,
        minutes_slept: u32,
        slept_on_time: bool,
    ) {
        sleeper.require_auth();
        validate_sleep_type(&sleep_type);
        validate_session_minutes(minutes_slept);

        let mut profile = read_profile_required(&env, &sleeper);
        sync_week(&mut profile, current_week(&env));

        let goal_was_reached = profile.weekly_goal_reached;
        let current_day = current_day(&env);
        if slept_on_time {
            if profile.session_count == 0 {
                profile.current_streak = 1;
            } else if current_day == profile.last_sleep_day {
            } else if current_day == profile.last_sleep_day + 1 {
                profile.current_streak += 1;
            } else {
                profile.current_streak = 1;
            }
            profile.on_time_session_count += 1;
        } else {
            profile.current_streak = 0;
        }

        profile.last_sleep_day = current_day;
        profile.total_minutes += minutes_slept;
        profile.minutes_this_week += minutes_slept;
        profile.weekly_goal_reached = profile.minutes_this_week >= profile.weekly_goal_minutes;

        let recovery_score = calculate_recovery_score(&profile);
        let session = SleepSession {
            sleep_type: sleep_type.clone(),
            minutes_slept,
            slept_on_time,
            timestamp: env.ledger().timestamp(),
            streak_after_log: profile.current_streak,
            recovery_score_after_log: recovery_score,
        };

        write_session(&env, &sleeper, profile.session_count, &session);
        profile.session_count += 1;
        write_profile(&env, &sleeper, &profile);
        update_leaderboard(&env, sleeper.clone(), profile.display_name.clone(), recovery_score);

        SleepLogged {
            sleeper: sleeper.clone(),
            sleep_type,
            minutes_slept,
            slept_on_time,
            minutes_this_week: profile.minutes_this_week,
            current_streak: profile.current_streak,
            recovery_score,
        }
        .publish(&env);

        if !goal_was_reached && profile.weekly_goal_reached {
            WeeklyGoalReached {
                sleeper: sleeper.clone(),
                weekly_goal_minutes: profile.weekly_goal_minutes,
                minutes_this_week: profile.minutes_this_week,
                recovery_score,
            }
            .publish(&env);

            if let Some(reward_contract_id) = env.storage().persistent().get::<_, Address>(&DataKey::RewardContract) {
                let client = reward_contract::Client::new(&env, &reward_contract_id);
                client.mint(&sleeper, &100);
            }
        }
    }

    pub fn has_profile(env: Env, sleeper: Address) -> bool {
        env.storage().persistent().has(&DataKey::Profile(sleeper))
    }

    pub fn query_sleeper_reward(env: Env, reward_contract_id: Address, sleeper: Address) -> u32 {
        // Obsolete function, retained for compatibility if needed.
        0
    }

    pub fn get_dashboard(env: Env, sleeper: Address) -> SleepDashboard {
        let mut profile = read_profile_required(&env, &sleeper);
        if current_week(&env) > profile.active_week {
            profile.minutes_this_week = 0;
            profile.weekly_goal_reached = false;
        }

        SleepDashboard {
            display_name: profile.display_name.clone(),
            weekly_goal_minutes: profile.weekly_goal_minutes,
            total_minutes: profile.total_minutes,
            minutes_this_week: profile.minutes_this_week,
            session_count: profile.session_count,
            on_time_session_count: profile.on_time_session_count,
            current_streak: profile.current_streak,
            created_at: profile.created_at,
            goal_reached_this_week: profile.minutes_this_week >= profile.weekly_goal_minutes,
            consistency_score: calculate_consistency_score(&profile),
            recovery_score: calculate_recovery_score(&profile),
        }
    }

    pub fn get_session_count(env: Env, sleeper: Address) -> u32 {
        read_profile_optional(&env, &sleeper)
            .map(|profile| profile.session_count)
            .unwrap_or(0)
    }

    pub fn get_session(env: Env, sleeper: Address, index: u32) -> SleepSession {
        let count = Self::get_session_count(env.clone(), sleeper.clone());
        assert!(index < count, "Session index out of bounds");

        env.storage()
            .persistent()
            .get(&DataKey::Session(sleeper, index))
            .unwrap_or_else(|| panic!("Session not found"))
    }

    pub fn get_leaderboard(env: Env) -> soroban_sdk::Vec<LeaderboardEntry> {
        env.storage()
            .persistent()
            .get(&DataKey::Leaderboard)
            .unwrap_or_else(|| soroban_sdk::Vec::new(&env))
    }
}

fn read_profile_optional(env: &Env, sleeper: &Address) -> Option<SleepProfile> {
    env.storage()
        .persistent()
        .get(&DataKey::Profile(sleeper.clone()))
}

fn read_profile_required(env: &Env, sleeper: &Address) -> SleepProfile {
    read_profile_optional(env, sleeper).unwrap_or_else(|| panic!("Profile not found"))
}

fn write_profile(env: &Env, sleeper: &Address, profile: &SleepProfile) {
    env.storage()
        .persistent()
        .set(&DataKey::Profile(sleeper.clone()), profile);
}

fn write_session(env: &Env, sleeper: &Address, index: u32, session: &SleepSession) {
    env.storage()
        .persistent()
        .set(&DataKey::Session(sleeper.clone(), index), session);
}

fn sync_week(profile: &mut SleepProfile, current_week: u64) {
    if current_week > profile.active_week {
        profile.active_week = current_week;
        profile.minutes_this_week = 0;
        profile.weekly_goal_reached = false;
    }
}

fn calculate_consistency_score(profile: &SleepProfile) -> u32 {
    if profile.session_count == 0 {
        return 0;
    }

    (profile.on_time_session_count * 100) / profile.session_count
}

fn calculate_recovery_score(profile: &SleepProfile) -> u32 {
    let weekly_progress = if profile.weekly_goal_minutes == 0 {
        0
    } else {
        core::cmp::min(50, (profile.minutes_this_week * 50) / profile.weekly_goal_minutes)
    };
    let streak_score = core::cmp::min(25, profile.current_streak * 5);
    let consistency_score = calculate_consistency_score(profile) / 4;

    core::cmp::min(100, weekly_progress + streak_score + consistency_score)
}

fn current_week(env: &Env) -> u64 {
    env.ledger().timestamp() / WEEK_IN_SECONDS
}

fn current_day(env: &Env) -> u64 {
    env.ledger().timestamp() / DAY_IN_SECONDS
}

fn validate_display_name(display_name: &String) {
    let length = display_name.len();
    assert!(length >= 3 && length <= 32, "Display name must be 3-32 chars");
}

fn validate_sleep_type(sleep_type: &String) {
    let length = sleep_type.len();
    assert!(length >= 3 && length <= 48, "Sleep type must be 3-48 chars");
}

fn validate_session_minutes(minutes_slept: u32) {
    assert!(
        (MIN_SESSION_MINUTES..=MAX_SESSION_MINUTES).contains(&minutes_slept),
        "Session minutes out of range"
    );
}

fn validate_weekly_goal(weekly_goal_minutes: u32) {
    assert!(
        (MIN_GOAL_MINUTES..=MAX_GOAL_MINUTES).contains(&weekly_goal_minutes),
        "Weekly goal out of range"
    );
}

fn update_leaderboard(env: &Env, sleeper: Address, display_name: String, recovery_score: u32) {
    let key = DataKey::Leaderboard;
    let mut leaderboard: soroban_sdk::Vec<LeaderboardEntry> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));

    let mut existing_idx: Option<u32> = None;
    for i in 0..leaderboard.len() {
        if leaderboard.get(i).unwrap().sleeper == sleeper {
            existing_idx = Some(i);
            break;
        }
    }
    if let Some(idx) = existing_idx {
        leaderboard.remove(idx);
    }

    let new_entry = LeaderboardEntry {
        sleeper,
        display_name,
        recovery_score,
    };
    leaderboard.push_back(new_entry);

    let mut sorted_list = soroban_sdk::Vec::new(env);
    while leaderboard.len() > 0 {
        let mut max_idx = 0;
        let mut max_score = 0;
        for i in 0..leaderboard.len() {
            let entry = leaderboard.get(i).unwrap();
            if entry.recovery_score >= max_score {
                max_score = entry.recovery_score;
                max_idx = i;
            }
        }
        sorted_list.push_back(leaderboard.get(max_idx).unwrap());
        leaderboard.remove(max_idx);
    }

    if sorted_list.len() > 10 {
        let mut trimmed_list = soroban_sdk::Vec::new(env);
        for i in 0..10 {
            trimmed_list.push_back(sorted_list.get(i).unwrap());
        }
        sorted_list = trimmed_list;
    }

    env.storage().persistent().set(&key, &sorted_list);
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Events, Ledger};

    fn setup() -> (Env, SleepSyncClient<'static>, Address) {
        let env = Env::default();
        let contract_id = env.register(SleepSync, ());
        let client = SleepSyncClient::new(&env, &contract_id);
        let sleeper = Address::generate(&env);
        env.mock_all_auths();
        (env, client, sleeper)
    }

    fn text(env: &Env, value: &str) -> String {
        String::from_str(env, value)
    }

    #[test]
    fn creates_profile_and_reads_dashboard() {
        let (env, client, sleeper) = setup();

        client.save_profile(&sleeper, &text(&env, "Deep Sleeper"), &3_360);
        let dashboard = client.get_dashboard(&sleeper);

        assert_eq!(dashboard.display_name, text(&env, "Deep Sleeper"));
        assert_eq!(dashboard.weekly_goal_minutes, 3_360);
        assert_eq!(dashboard.total_minutes, 0);
        assert_eq!(dashboard.recovery_score, 0);
        assert!(!dashboard.goal_reached_this_week);
    }



    #[test]
    fn logs_sessions_and_grows_streak_across_days() {
        let (env, client, sleeper) = setup();

        client.save_profile(&sleeper, &text(&env, "Moon Keeper"), &3_000);
        client.log_session(&sleeper, &text(&env, "Night Sleep"), &420, &true);

        env.ledger().set_timestamp(DAY_IN_SECONDS + 90);
        client.log_session(&sleeper, &text(&env, "Night Sleep"), &390, &true);

        let dashboard = client.get_dashboard(&sleeper);
        let session = client.get_session(&sleeper, &1);

        assert_eq!(dashboard.total_minutes, 810);
        assert_eq!(dashboard.minutes_this_week, 810);
        assert_eq!(dashboard.session_count, 2);
        assert_eq!(dashboard.current_streak, 2);
        assert_eq!(dashboard.consistency_score, 100);
        assert!(dashboard.recovery_score > 0);
        assert_eq!(session.sleep_type, text(&env, "Night Sleep"));
        assert_eq!(session.minutes_slept, 390);
        assert!(session.slept_on_time);
    }

    #[test]
    fn resets_weekly_progress_after_boundary() {
        let (env, client, sleeper) = setup();

        client.save_profile(&sleeper, &text(&env, "Weekly Rest"), &2_400);
        client.log_session(&sleeper, &text(&env, "Deep Rest"), &420, &true);

        env.ledger().set_timestamp(WEEK_IN_SECONDS + DAY_IN_SECONDS);
        let dashboard = client.get_dashboard(&sleeper);

        assert_eq!(dashboard.minutes_this_week, 0);
        assert_eq!(dashboard.total_minutes, 420);
        assert!(!dashboard.goal_reached_this_week);
    }

    #[test]
    #[should_panic(expected = "Profile not found")]
    fn rejects_missing_profile_session_logs() {
        let (env, client, sleeper) = setup();
        client.log_session(&sleeper, &text(&env, "No profile yet"), &60, &true);
    }

    #[test]
    #[should_panic(expected = "Display name must be 3-32 chars")]
    fn rejects_short_display_names() {
        let (env, client, sleeper) = setup();
        client.save_profile(&sleeper, &text(&env, "AB"), &200);
    }

    #[test]
    #[should_panic(expected = "Session minutes out of range")]
    fn rejects_short_sessions() {
        let (env, client, sleeper) = setup();
        client.save_profile(&sleeper, &text(&env, "Rest Guardian"), &200);
        client.log_session(&sleeper, &text(&env, "Nap"), &4, &true);
    }

    #[test]
    #[should_panic(expected = "Weekly goal out of range")]
    fn rejects_bad_goal_updates() {
        let (env, client, sleeper) = setup();
        client.save_profile(&sleeper, &text(&env, "Goal Guard"), &200);
        client.update_weekly_goal(&sleeper, &20);
    }

    #[test]
    fn accepts_boundary_values_for_profile_and_session() {
        let (env, client, sleeper) = setup();

        client.save_profile(&sleeper, &text(&env, "Min"), &MIN_GOAL_MINUTES);
        client.log_session(
            &sleeper,
            &text(&env, "Nap"),
            &MIN_SESSION_MINUTES,
            &true,
        );
        client.update_weekly_goal(&sleeper, &MAX_GOAL_MINUTES);
        client.log_session(
            &sleeper,
            &text(&env, "Maximum Recovery Window"),
            &MAX_SESSION_MINUTES,
            &false,
        );

        let dashboard = client.get_dashboard(&sleeper);
        assert_eq!(dashboard.weekly_goal_minutes, MAX_GOAL_MINUTES);
        assert_eq!(
            dashboard.total_minutes,
            MIN_SESSION_MINUTES + MAX_SESSION_MINUTES
        );
        assert_eq!(dashboard.session_count, 2);
    }

    #[test]
    fn goal_reached_event_emits_once_on_threshold_crossing() {
        let (env, client, sleeper) = setup();

        client.save_profile(&sleeper, &text(&env, "Threshold Dreamer"), &500);
        client.log_session(&sleeper, &text(&env, "Night Sleep"), &300, &true);
        client.log_session(&sleeper, &text(&env, "Night Sleep"), &220, &true);

        assert_eq!(env.events().all().events().len(), 2);

        client.log_session(&sleeper, &text(&env, "Nap"), &60, &false);

        assert_eq!(env.events().all().events().len(), 1);
    }

    #[test]
    fn leaderboard_updates_and_sorts_correctly() {
        let env = Env::default();
        let contract_id = env.register(SleepSync, ());
        let client = SleepSyncClient::new(&env, &contract_id);
        env.mock_all_auths();

        let s1 = Address::generate(&env);
        let s2 = Address::generate(&env);
        let s3 = Address::generate(&env);

        client.save_profile(&s1, &text(&env, "Sleeper One"), &1000);
        client.save_profile(&s2, &text(&env, "Sleeper Two"), &1000);
        client.save_profile(&s3, &text(&env, "Sleeper Three"), &1000);

        client.log_session(&s1, &text(&env, "Sleep"), &480, &true);
        client.log_session(&s2, &text(&env, "Sleep"), &240, &true);
        client.log_session(&s3, &text(&env, "Sleep"), &60, &false);

        let leaderboard = client.get_leaderboard();
        assert_eq!(leaderboard.len(), 3);

        let first = leaderboard.get(0).unwrap();
        let second = leaderboard.get(1).unwrap();
        let third = leaderboard.get(2).unwrap();

        assert_eq!(first.display_name, text(&env, "Sleeper One"));
        assert_eq!(second.display_name, text(&env, "Sleeper Two"));
        assert_eq!(third.display_name, text(&env, "Sleeper Three"));
        assert!(first.recovery_score >= second.recovery_score);
        assert!(second.recovery_score >= third.recovery_score);
    }
}
