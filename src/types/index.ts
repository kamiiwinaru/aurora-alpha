export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
  updatedAt: Date
}

export interface EveCharacter {
  characterId: number
  characterName: string
  corporationId: number
  allianceId?: number
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface EveSkill {
  skillId: number
  skillName: string
  activeLevel: number
  trainedLevel: number
  skillpointsInSkill: number
}

export interface EveSkillQueueItem {
  skillId: number
  skillName: string
  finishedLevel: number
  queuePosition: number
  startDate?: string
  finishDate?: string
  levelStartSp?: number
  levelEndSp?: number
  trainingStartSp?: number
}

export interface EveAsset {
  itemId: number
  typeId: number
  typeName: string
  groupName?: string
  locationId: number
  locationName: string
  quantity: number
  isBlueprintCopy?: boolean
}

export interface EveIndustryJob {
  jobId: number
  activityId: number
  activityName: string
  blueprintTypeId: number
  blueprintTypeName: string
  outputTypeId?: number
  outputTypeName?: string
  runs: number
  status: 'active' | 'cancelled' | 'delivered' | 'paused' | 'ready' | 'reverted'
  startDate: string
  endDate: string
  facilityId: number
}

export interface EveMarketOrder {
  orderId: number
  typeId: number
  typeName: string
  locationId: number
  volumeTotal: number
  volumeRemain: number
  price: number
  isBuyOrder: boolean
  issued: string
  duration: number
  state: 'active' | 'cancelled' | 'expired' | 'pending' | 'character_deleted'
}

export interface EveWalletTransaction {
  transactionId: number
  date: string
  typeName: string
  quantity: number
  unitPrice: number
  isBuy: boolean
  clientName: string
  locationName: string
}

export interface EveWalletJournalEntry {
  id: number
  date: string
  refType: string
  amount: number
  balance: number
  description: string
}

export interface EveBlueprint {
  itemId: number
  typeId: number
  typeName: string
  locationId: number
  locationName: string
  materialEfficiency: number
  timeEfficiency: number
  runs: number          // -1 = BPO
  isCopy: boolean
}

export interface EveCharacterAttributes {
  charisma: number
  intelligence: number
  memory: number
  perception: number
  willpower: number
  bonusRemaps?: number
  lastRemapDate?: string
  accruedRemapCooldownDate?: string
}

export interface EveImplant {
  typeId: number
  typeName: string
  slot: number
}

export interface EveJumpClone {
  jumpCloneId: number
  locationId: number
  locationName: string
  implants: EveImplant[]
}

export interface EveShipLocation {
  shipTypeId: number
  shipName: string
  shipTypeName: string
  solarSystemId: number
  solarSystemName: string
  stationId?: number
  stationName?: string
}

export interface EveStanding {
  fromId: number
  fromName: string
  fromType: 'agent' | 'npc_corp' | 'faction'
  standing: number
}

export interface EveContract {
  contractId: number
  type: string
  status: string
  title: string
  issuerId: number
  issuerName: string
  assigneeId: number
  assigneeName: string
  dateIssued: string
  dateExpired: string
  price: number
  volume: number
  forCorporation: boolean
  source?: 'character' | 'alliance' | 'corporation'
}

export interface EveMiningEntry {
  date: string
  solarSystemId: number
  solarSystemName: string
  typeId: number
  typeName: string
  quantity: number
}

export interface EveKillmail {
  killmailId: number
  killmailTime: string
  solarSystemId: number
  solarSystemName: string
  shipTypeId: number
  shipTypeName: string
  isLoss: boolean
  attackerCount: number
}

export interface EveLoyaltyPoint {
  corporationId: number
  corporationName: string
  loyaltyPoints: number
}

export interface EveNotification {
  notificationId: number
  type: string
  timestamp: string
  text: string
}

export interface EveMail {
  mailId: number
  subject: string
  fromId: number
  fromName: string
  timestamp: string
  isRead: boolean
  labelIds: number[]
  body?: string
}

export interface EveMailLabel {
  labelId: number
  name: string
  unreadCount: number
}

export interface JaniceItem {
  name: string
  buyPrice: number
  sellPrice: number
  splitPrice: number
  quantity: number
  volume: number
}

export interface JaniceAppraisal {
  effectivePrices: {
    totalBuyPrice: number
    totalSellPrice: number
    totalSplitPrice: number
    totalVolume: number
  }
  items: JaniceItem[]
  code?: string
}

export type ActivePanel = 'chat' | 'notifications' | 'skills' | 'industry' | 'assets' | 'market' | 'janice' | 'zkill' | 'intel' | 'roadmap' | 'map' | 'landing' | 'landing-login'
