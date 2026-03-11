export type Trip = {
  distance_tier: number;
  key_needed: number;
  speed_tier: number;
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
  trips: Record<string, Trip>;
};

const ItemIdOffset = 8902301100000;

export enum ItemType {
  DistanceReduction = ItemIdOffset + 1,
  Key = ItemIdOffset + 2,
  ScoutingDistance = ItemIdOffset + 3,
  CollectionDistance = ItemIdOffset + 4,

  ShuffleTrap = ItemIdOffset + 101,
  SilenceTrap = ItemIdOffset + 102,
  FogOfWarTrap = ItemIdOffset + 103,

  PushUpTrap = ItemIdOffset + 151,
  SocializingTrap = ItemIdOffset + 152,
  SitUpTrap = ItemIdOffset + 153,
  JumpingJackTrap = ItemIdOffset + 154,
  TouchGrassTrap = ItemIdOffset + 155,

  MacguffinA = ItemIdOffset + 201,
  MacguffinR = ItemIdOffset + 202,
  MacguffinC = ItemIdOffset + 203,
  MacguffinH = ItemIdOffset + 204,
  MacguffinI = ItemIdOffset + 205,
  MacguffinP = ItemIdOffset + 206,
  MacguffinE = ItemIdOffset + 207,
  MacguffinL = ItemIdOffset + 208,
  MacguffinA2 = ItemIdOffset + 209,
  MacguffinHyphen = ItemIdOffset + 210,
  MacguffinG = ItemIdOffset + 211,
  MacguffinO = ItemIdOffset + 212,
  MacguffinExclamation = ItemIdOffset + 213,
}
