// The 30 sample categories in the retail audit tool (../retail-audit-tool/src/seeds).
// `noun` is how a shopper names one product and several; questions use it in
// place of {item} / {items}.

export type Category = { slug: string; name: string; noun: [string, string]; group: string };

const c = (slug: string, name: string, singular: string, plural: string, group: string): Category => ({ slug, name, noun: [singular, plural], group });

export const CATEGORIES: Category[] = [
  c("tv", "TV", "TV", "TVs", "Home entertainment"),
  c("vacuum-cleaners", "Vacuum Cleaners", "vacuum cleaner", "vacuum cleaners", "Floor care"),
  c("refrigerators", "Refrigerators", "refrigerator", "refrigerators", "Major appliance"),
  c("microwaves", "Microwaves", "microwave", "microwaves", "Kitchen appliance"),
  c("washing-machines", "Washing Machines", "washing machine", "washing machines", "Major appliance"),
  c("dishwashers", "Dishwashers", "dishwasher", "dishwashers", "Major appliance"),
  c("dryers", "Dryers", "clothes dryer", "clothes dryers", "Major appliance"),
  c("ranges", "Ranges", "range", "ranges", "Major appliance"),
  c("cooktops", "Cooktops", "cooktop", "cooktops", "Major appliance"),
  c("range-hoods", "Range Hoods", "range hood", "range hoods", "Major appliance"),
  c("freezers", "Freezers", "freezer", "freezers", "Major appliance"),
  c("air-conditioners", "Air Conditioners", "air conditioner", "air conditioners", "Climate"),
  c("air-purifiers", "Air Purifiers", "air purifier", "air purifiers", "Climate"),
  c("dehumidifiers", "Dehumidifiers", "dehumidifier", "dehumidifiers", "Climate"),
  c("smartphones", "Smartphones", "smartphone", "smartphones", "Mobile"),
  c("tablets", "Tablets", "tablet", "tablets", "Mobile"),
  c("smartwatches", "Smartwatches", "smartwatch", "smartwatches", "Mobile"),
  c("laptops", "Laptops", "laptop", "laptops", "Computing"),
  c("monitors", "Monitors", "monitor", "monitors", "Computing"),
  c("printers", "Printers", "printer", "printers", "Computing"),
  c("wi-fi-routers", "Wi-Fi Routers", "Wi-Fi router", "Wi-Fi routers", "Computing"),
  c("soundbars", "Soundbars", "soundbar", "soundbars", "Audio"),
  c("headphones", "Headphones", "pair of headphones", "headphones", "Audio"),
  c("bluetooth-speakers", "Bluetooth Speakers", "Bluetooth speaker", "Bluetooth speakers", "Audio"),
  c("projectors", "Projectors", "projector", "projectors", "Home entertainment"),
  c("gaming-consoles", "Gaming Consoles", "gaming console", "gaming consoles", "Home entertainment"),
  c("cameras", "Cameras", "camera", "cameras", "Imaging"),
  c("security-cameras", "Security Cameras", "security camera", "security cameras", "Smart home"),
  c("coffee-makers", "Coffee Makers", "coffee maker", "coffee makers", "Kitchen appliance"),
  c("air-fryers", "Air Fryers", "air fryer", "air fryers", "Kitchen appliance"),
];
