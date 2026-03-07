export type Trip = {
  distance_tier: number;
  key_needed: number;
  speed_tier: number;
};

type TripDict = {
  [index: string]: Trip;
};

enum Goal {
  OneHardTravel = 0,
  Allsanity = 1,
  ShortMacGuffin = 2,
  LongMacGuffin = 3,
}

export type APGoSlotData = {
  goal: Goal;
  minimum_distance: number;
  maximum_distance: number;
  speed_requirement: number;
  trips: TripDict;
};
