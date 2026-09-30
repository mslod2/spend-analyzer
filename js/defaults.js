/* Default categories, issuer-category mappings, and payment detection. All editable in Settings. */
(function (SA) {
  'use strict';

  const PAYMENTS = 'Payments & Transfers';
  const UNCATEGORIZED = 'Uncategorized';
  const REWARDS = 'Rewards & Credits';
  // Bump when defaults change in a way existing installs should pick up (see SA.store.load).
  const SETTINGS_SCHEMA = 3;

  const CATEGORIES = [
    'Groceries', 'Dining', 'Shopping', 'Gas & Auto', 'Transportation', 'Travel', 'Entertainment',
    'Subscriptions', 'Bills & Utilities', 'Health', 'Home', 'Personal Care', 'Education',
    'Gifts & Donations', 'Fees & Interest', 'Other', UNCATEGORIZED, REWARDS, PAYMENTS,
  ];

  // Lower-cased issuer category -> app category. Covers Chase, Amex, Capital One, Discover, Citi, Apple Card.
  // Amex uses "Group-Subgroup" strings; lookups also try each half (see SA.rules.mapIssuerCategory).
  const ISSUER_MAP = {
    // Chase
    'food & drink': 'Dining', 'groceries': 'Groceries', 'shopping': 'Shopping', 'gas': 'Gas & Auto',
    'automotive': 'Gas & Auto', 'travel': 'Travel', 'entertainment': 'Entertainment',
    'bills & utilities': 'Bills & Utilities', 'health & wellness': 'Health', 'personal': 'Personal Care',
    'home': 'Home', 'education': 'Education', 'gifts & donations': 'Gifts & Donations',
    'fees & adjustments': 'Fees & Interest', 'professional services': 'Other',
    // Capital One
    'dining': 'Dining', 'merchandise': 'Shopping', 'gas/automotive': 'Gas & Auto', 'grocery': 'Groceries',
    'other travel': 'Travel', 'airfare': 'Travel', 'lodging': 'Travel', 'car rental': 'Travel',
    'health care': 'Health', 'internet': 'Bills & Utilities', 'phone/cable': 'Bills & Utilities',
    'utilities': 'Bills & Utilities', 'insurance': 'Bills & Utilities', 'other services': 'Other',
    'fee/interest charge': 'Fees & Interest', 'payment/credit': PAYMENTS, 'other': 'Other',
    // Discover
    'restaurants': 'Dining', 'supermarkets': 'Groceries', 'gasoline': 'Gas & Auto',
    'travel/ entertainment': 'Travel', 'travel/entertainment': 'Travel', 'services': 'Other',
    'department stores': 'Shopping', 'home improvement': 'Home', 'medical services': 'Health',
    'government services': 'Bills & Utilities', 'payments and credits': PAYMENTS, 'warehouse clubs': 'Groceries',
    // Amex (group and subgroup halves)
    'restaurant': 'Dining', 'bar & café': 'Dining', 'bar & cafe': 'Dining',
    'merchandise & supplies': 'Shopping', 'groceries & supermarkets': 'Groceries',
    'transportation': 'Transportation', 'fuel': 'Gas & Auto', 'taxis & coach': 'Transportation',
    'parking charges': 'Transportation', 'airline': 'Travel', 'lodging & hotels': 'Travel', 'travel agencies': 'Travel',
    'communications': 'Bills & Utilities', 'cable & internet comm': 'Bills & Utilities',
    'business services': 'Other', 'health care services': 'Health', 'pharmacies': 'Health',
    'fees & adjustments-fees & adjustments': 'Fees & Interest',
    // Apple Card
    'payment': PAYMENTS, 'airlines': 'Travel', 'hotels': 'Travel', 'medical': 'Health',
  };

  // Descriptions that indicate a card payment or transfer (only applied to money coming IN to the card).
  const PAYMENT_DESC = /\b(payment|autopay|auto[- ]pay|pymt|pmt|thank you|e-?payment|balance transfer|ach credit|directpay)\b/i;
  const PAYMENT_TYPE = /\bpayment\b/i;
  const PAYMENT_ISSUER_CAT = /^payments?\b/i;
  // Rewards redemptions and card-perk statement credits ("Thankyou Points Redeemed", "YOUR CASH REWARD/REFUND IS",
  // "ANNUAL HOTEL CREDIT"). Only applied to money coming in; rules can override.
  const REWARD_DESC = /\b(rewards?|cash ?back|points? redeemed|redemption|statement credit|annual [a-z ]*credit|travel credit)\b/i;

  /*
   * Last-resort category guesses from the merchant name, for issuers whose exports have no category column (Citi).
   * Matched against "MERCHANT | RAW DESCRIPTION" in upper case; first match wins, so specific names come before
   * generic words (e.g. "MAIN AND MARKET DECK" is parking, not groceries).
   */
  const w = (words) => new RegExp('\\b(' + words + ')\\b');
  const KEYWORD_CATEGORIES = [
    // Restaurant point-of-sale prefixes (Toast, SpotOn) and workplace micro-markets.
    [/\| (TST|SPO|TOAST) ?\*/, 'Dining'],
    [/^365 MARKET/, 'Dining'],
    [w('UNITED WAY|DONATION|CHARITY|GOFUNDME|CHURCH'), 'Gifts & Donations'],
    [w('MEMBERSHIP FEE|ANNUAL FEE|LATE FEE|INTEREST CHARGE|FOREIGN TRANSACTION FEE'), 'Fees & Interest'],
    [w('NETFLIX|SPOTIFY|HULU|DISNEY PLUS|HBO|PARAMOUNT|PEACOCK|YOUTUBE|PATREON|PLAYSTATION NETWORK|XBOX|NINTENDO|APPLE\\.COM/BILL|VPN'), 'Subscriptions'],
    [w('AT&T|VERIZON|T-MOBILE|COMCAST|XFINITY|SPECTRUM|INSURANCE|STATE FARM|PROGRESSIVE|GEICO|ALLSTATE|PG&E|ELECTRIC|UTILITIES|WATER DEPT|BUREAU MOTOR|AUTO TITLE|BMV|DMV'), 'Bills & Utilities'],
    [w('PARKING|PARK MOBILE|PARKMOBILE|METERS?|GARAGE|DECK|LOT|PROPARK|TURNPIKE|TOLLS?|EZPASS|E-ZPASS|UBER|LYFT|TAXI|TRANSIT|METRO CARD'), 'Transportation'],
    [w('UNITED|DELTA|AMERICAN AIR|SOUTHWEST|JETBLUE|SPIRIT AIR|FRONTIER|ALASKA AIR|AIRLINES?|AIRBNB|VRBO|HOTELS?|MOTEL|MARRIOTT|HILTON|HYATT|SHERATON|WESTIN|HAMPTON INN|HOLIDAY INN|EXPEDIA|BOOKING\\.COM|FERRY|FRRY|FER|AMTRAK|GREYHOUND|HERTZ|ENTERPRISE RENT|AVIS'), 'Travel'],
    [w('SUNOCO|SHELL|BP|SPEEDWAY|MARATHON|EXXON|MOBIL|CHEVRON|CITGO|VALERO|SINCLAIR|76|CIRCLE ?K|BUC-EE\'S|LOVE\'S|SHEETZ|WAWA|QUIKTRIP|CASEY\'S|PILOT|FLYING J|GETGO|PETRO|FUEL|GAS|AUTOZONE|ADVANCE AUTO|O\'REILLY|NAPA|JIFFY LUBE|TIRES?|CAR WASH|AUTO PARTS|POWERSPORTS|CYCLE GEAR|HARLEY'), 'Gas & Auto'],
    [w('CVS|WALGREENS|RITE AID|PHARMACY|VISION|OPTICAL|EYE|DENTAL|DENTIST|MEDICAL|CLINIC|URGENT CARE|HEALTH|HOSP HEALTH|LABCORP|QUEST DIAG'), 'Health'],
    [w('VET|VETERINARY|ANIMAL HOSP|PET|PETCO|PETSMART|SALON|NAILS|SPA|BARBER|HAIR|BROW|SHEAR|MASSAGE|ULTA|SEPHORA'), 'Personal Care'],
    [w('CINEMAS?|THEATER|THEATRE|FANDANGO|AMC|REGAL|SILVERSPOT|TICKETMASTER|STUBHUB|SEATGEEK|MUSEUM|ZOO|ORCH|ORCHESTRA|MUSIC CENT|CONCERT|BOWLING|GOLF|RANGE USA|SHOOTING RANGE|AQUARIUM'), 'Entertainment'],
    [w('HOME DEPOT|LOWE\'?S|MENARDS|ACE HARDWARE|HARDWARE|IKEA|CRATE|BED BATH|WAYFAIR|STORAGE|U-HAUL|GARDEN CEN|AT HOME'), 'Home'],
    [w('MCDONALD\'?S|WENDY\'?S|SUBWAY|CHIPOTLE|QDOBA|CHICK-FIL-A|TACO BELL|POTBELLY|PANERA|STARBUCKS|DUNKIN|CULVERS?|SHAKE SHACK|PENN STATION|BRUEGGERS|FREDDY\'?S|RAISING CANE\'?S|CRACKER BARREL|BOB EVANS|FIVE GUYS|JIMMY JOHNS|JERSEY MIKE\'?S|ARBY\'?S|BURGER KING|DOMINO\'?S|PAPA JOHNS|SONIC|DAIRY QUEEN|KFC|POPEYES|WAFFLE HOUSE|IHOP|DENNY\'?S|APPLEBEE\'?S|OLIVE GARDEN|BUFFALO WILD|WINKING LIZARD|HANDELS|DAVES HOT CHICKEN'), 'Dining'],
    [w('RESTAURANTS?|RESTAURAN|RESTAU|CAFE|COFFEE|COF|ESPRESSO|BAKERY|DONUTS?|BAGELS?|PIZZA|PIZZERIA?|PIZZERI|BURGERS?|GRILL|TACOS?|TAQUERIA|CANTINA|SUSHI|RAMEN|NOODLES?|BBQ|DINER|DELI|SUBS|SUBSHOPPE|SANDWICH(ES)?|SANDWICHE|STEAKS?|STEAKHOUSE|GYROS?|HIBACHI|THAI|CHINESE|JAPANESE|MEXICAN|ITALIAN|PANCAKES?|PANCAKE HOUS|EGGS?|ICE CREAM|ICE C|CREAMERY|SMOOTHIES?|JUICE|TEA|BREW\\w*|TAVERN|PUB|BAR|BEER GARDEN|TAPROOM|TAPRO|LOUNGE|SALOON|HONKY TONK|WINERY|KITCHEN|KITC|BISTRO|CATERING|FOOD TRUCK|CHICKEN|CHICKN|WINGS'), 'Dining'],
    [w('KROGER|RALPHS|GIANT EAGLE|HEINEN\'?S|SUPERMARKET|GROCERY|GROCER|ALDI|TRADER JOE\'?S|WHOLE FOODS|FOOD CITY|ACME|SAFEWAY|PUBLIX|MEIJER|WEGMANS|SPROUTS|MEATS|BUTCHER|PRODUCE|ORCHARDS?|FARMS|FOOD MART|MARKET|LIQUOR|WINE & BEV\\w*|BEVERAGE'), 'Groceries'],
    [w('TARGET|WALMART|AMAZON|EBAY|ETSY|BOOT BARN|GUITAR CENTER|BEST BUY|TJ MAXX|MARSHALLS|HOMEGOODS|KOHL\'?S|MACY\'?S|NORDSTROM|OLD NAVY|BOOKS?|BOOKSTORE|DOLLAR|DGX|FIVE BELOW|MICHAELS|HOBBY LOBBY|DICK\'?S SPORTING|NIKE|LEVI|ZARA|COSTCO|SAM\'S CLUB|APPLE STORE|OUTFITTERS'), 'Shopping'],
    [w('USPS|UPS STORE|FEDEX|TURBOTAX|INTUIT|H&R BLOCK|FREETAXUSA'), 'Other'],
  ];

  function defaultSettings() {
    return {
      categories: CATEGORIES.slice(),
      excludedCategories: [PAYMENTS, REWARDS],
      issuerCategoryMap: Object.assign({}, ISSUER_MAP),
      income: { mode: 'monthly', monthly: null, paycheck: null, frequency: 'biweekly' },
      schema: SETTINGS_SCHEMA,
    };
  }

  SA.defaults = { PAYMENTS, UNCATEGORIZED, REWARDS, SETTINGS_SCHEMA, CATEGORIES, ISSUER_MAP, PAYMENT_DESC, PAYMENT_TYPE, PAYMENT_ISSUER_CAT,
    REWARD_DESC, KEYWORD_CATEGORIES, defaultSettings };
})(window.SA = window.SA || {});
