export const NOTIF_TYPE_NAMES: Record<string, string> = {
  InsurancePayoutMsg:          'Insurance Payout',
  InsuranceExpirationMsg:      'Insurance Expired',
  InsuranceIssuedMsg:          'Insurance Issued',
  InsuranceInvalidatedMsg:     'Insurance Invalidated',
  InsuranceFirstShipMsg:       'Insurance: First Ship',
  KillReportVictim:            'Kill Report — Victim',
  KillReportFinalBlow:         'Kill Report — Final Blow',
  KillRightAvailable:          'Kill Right Available',
  KillRightAvailableOpen:      'Kill Right Available (Open)',
  KillRightEarned:             'Kill Right Earned',
  KillRightUsed:               'Kill Right Used',
  CorpAppNewMsg:               'Corp Application Received',
  CorpAppAcceptMsg:            'Corp Application Accepted',
  CorpAppRejectMsg:            'Corp Application Rejected',
  CorpAppRejectCustomMsg:      'Corp Application Rejected',
  CharAppAcceptMsg:            'Application Accepted',
  CharAppRejectMsg:            'Application Rejected',
  CharAppWithdrawMsg:          'Application Withdrawn',
  CharLeftCorpMsg:             'Character Left Corp',
  CharTerminationMsg:          'Character Terminated',
  CorpKicked:                  'Kicked from Corp',
  CorpNewCEOMsg:               'New CEO',
  CorpDividendMsg:             'Corp Dividend',
  CloneActivationMsg:          'Clone Activated',
  CloneActivationMsg2:         'Clone Activated',
  CloneMovedMsg:               'Clone Moved',
  CloneRevokedMsg1:            'Clone Revoked',
  CloneRevokedMsg2:            'Clone Revoked',
  JumpCloneDeletedMsg1:        'Jump Clone Deleted',
  JumpCloneDeletedMsg2:        'Jump Clone Deleted',
  NPCStandingsLost:            'NPC Standings Lost',
  NPCStandingsGained:          'NPC Standings Gained',
  ContactAdd:                  'Contact Added',
  ContactEdit:                 'Contact Updated',
  MissionOfferExpirationMsg:   'Mission Offer Expired',
  MissionTimeoutMsg:           'Mission Timed Out',
  MissionCanceledTriglavian:   'Mission Cancelled',
  StructureUnderAttack:        'Structure Under Attack',
  StructureLostShields:        'Structure Lost Shields',
  StructureLostArmor:          'Structure Lost Armor',
  StructureDestroyed:          'Structure Destroyed',
  StructureFuelAlert:          'Structure Fuel Alert',
  StructureLowReagentsAlert:   'Structure Low Reagents',
  StructureNoReagentsAlert:    'Structure No Reagents',
  StructureAnchoring:          'Structure Anchoring',
  StructureOnline:             'Structure Online',
  StructureUnanchoring:        'Structure Unanchoring',
  StructureServicesOffline:    'Structure Services Offline',
  StructureWentHighPower:      'Structure High Power Mode',
  StructureWentLowPower:       'Structure Low Power Mode',
  StructureImpendingAbandonmentAssetsAtRisk: 'Structure Abandonment Warning',
  OwnershipTransferred:        'Structure Ownership Transferred',
  SkyhookDeployed:             'Skyhook Deployed',
  SkyhookDestroyed:            'Skyhook Destroyed',
  SkyhookLostShields:          'Skyhook Lost Shields',
  SkyhookOnline:               'Skyhook Online',
  SkyhookUnderAttack:          'Skyhook Under Attack',
  MercenaryDenAttacked:        'Mercenary Den Under Attack',
  MercenaryDenReinforced:      'Mercenary Den Reinforced',
  MercenaryDenNewMTO:          'New Mercenary Tactical Operation',
  TowerAlertMsg:               'POS Under Attack',
  TowerResourceAlertMsg:       'POS Low Resources',
  WarDeclared:                 'War Declared',
  WarRetracted:                'War Retracted',
  WarInherited:                'War Inherited',
  WarSurrenderOfferMsg:        'War Surrender Offered',
  WarSurrenderDeclinedMsg:     'War Surrender Declined',
  AllWarDeclaredMsg:           'Alliance War Declared',
  AllWarRetractedMsg:          'Alliance War Retracted',
  BountyPlacedChar:            'Bounty Placed on You',
  BountyPlacedCorp:            'Bounty Placed on Corp',
  BountyYourBountyClaimed:     'Your Bounty Claimed',
  BountyClaimMsg:              'Bounty Claimed',
  BountyESSShared:             'ESS Bounty Shared',
  CorporationGoalCompleted:    'Corporation Goal Completed',
  CorporationGoalCreated:      'Corporation Goal Created',
  CorporationGoalClosed:       'Corporation Goal Closed',
  CorporationGoalExpired:      'Corporation Goal Expired',
  CorporationGoalLimitReached: 'Corporation Goal Limit Reached',
  BillOutOfMoneyMsg:           'Bill Unpaid',
  CorpAllBillMsg:              'Corp Bill Due',
  GameTimeAdded:               'Game Time Added',
  SPAutoRedeemed:              'SP Auto-Redeemed',
  LPAutoRedeemed:              'LP Auto-Redeemed',
  IndustryOperationFinished:   'Industry Job Finished',
  OfficeLeaseCanceledInsufficientStandings: 'Office Lease Cancelled',
  FWCharRankGainMsg:           'FW Rank Gained',
  FWCharRankLossMsg:           'FW Rank Lost',
}

export function notifLabel(type: string): string {
  if (NOTIF_TYPE_NAMES[type]) return NOTIF_TYPE_NAMES[type]
  return type
    .replace(/([A-Z][a-z])/g, ' $1')
    .replace(/\bMsg\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export type NotifCategory = 'kill' | 'war' | 'structure' | 'corp' | 'clone' | 'standings' | 'insurance' | 'industry' | 'mission' | 'bounty' | 'other'

export function notifCategory(type: string): NotifCategory {
  if (/KillReport|KillMail|KillRight/.test(type))              return 'kill'
  if (/War|AllWar/.test(type))                                  return 'war'
  if (/Structure|Skyhook|Tower|Mercenary/.test(type))           return 'structure'
  if (/Corp|Char.*Corp|CorpKicked|CorpNew|CorpDiv/.test(type)) return 'corp'
  if (/Clone/.test(type))                                       return 'clone'
  if (/Standing|Contact/.test(type))                            return 'standings'
  if (/Insurance/.test(type))                                   return 'insurance'
  if (/Industry|Bill/.test(type))                               return 'industry'
  if (/Mission/.test(type))                                     return 'mission'
  if (/Bounty/.test(type))                                      return 'bounty'
  return 'other'
}

// Color accent per category — returns Tailwind class fragments
export const NOTIF_CATEGORY_COLOR: Record<NotifCategory, { dot: string; text: string; bg: string }> = {
  kill:       { dot: 'bg-eve-red',    text: 'text-eve-red',    bg: 'bg-eve-red/5 border-l-eve-red/50' },
  war:        { dot: 'bg-eve-red',    text: 'text-eve-red',    bg: 'bg-eve-red/5 border-l-eve-red/50' },
  structure:  { dot: 'bg-eve-gold',   text: 'text-eve-gold',   bg: 'bg-eve-gold/5 border-l-eve-gold/50' },
  corp:       { dot: 'bg-eve-cyan',   text: 'text-eve-cyan',   bg: 'bg-eve-cyan/5 border-l-eve-cyan/40' },
  clone:      { dot: 'bg-eve-purple', text: 'text-eve-muted',  bg: '' },
  standings:  { dot: 'bg-eve-orange', text: 'text-eve-orange', bg: 'bg-eve-orange/5 border-l-eve-orange/40' },
  insurance:  { dot: 'bg-eve-green',  text: 'text-eve-green',  bg: 'bg-eve-green/5 border-l-eve-green/40' },
  industry:   { dot: 'bg-eve-cyan',   text: 'text-eve-muted',  bg: '' },
  mission:    { dot: 'bg-eve-muted',  text: 'text-eve-muted',  bg: '' },
  bounty:     { dot: 'bg-eve-gold',   text: 'text-eve-gold',   bg: 'bg-eve-gold/5 border-l-eve-gold/40' },
  other:      { dot: 'bg-eve-muted',  text: 'text-eve-muted',  bg: '' },
}

// Pull a one-line readable snippet from raw YAML notification text
export function notifSnippet(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/^[a-zA-Z_]+:\s*/gm, '')   // strip YAML keys
    .replace(/^\s*-\s*/gm, '')          // strip list markers
    .replace(/<[^>]+>/g, '')            // strip HTML
    .replace(/[{}\[\]'"]/g, '')         // strip YAML syntax chars
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72)
}
