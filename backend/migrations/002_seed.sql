-- Demo catalogue. Prices are integer minor units (the UI shows them as INR,
-- e.g. 459900 = Rs 4,599.00). ON CONFLICT keeps the seed re-runnable.

INSERT INTO products (sku, name, description, price_cents, stock) VALUES
  ('KB-MECH-01',  'Mechanical Keyboard',     'Hot-swappable 75% keyboard with tactile switches.',          459900, 40),
  ('MS-WL-02',    'Wireless Mouse',          'Ergonomic 2.4 GHz mouse with 70-day battery life.',          129900, 60),
  ('HP-ANC-03',   'Noise-Cancelling Headphones', 'Over-ear headphones with 30 h battery and ANC.',         899900, 25),
  ('MN-27-04',    '27" 1440p Monitor',       'IPS panel, 144 Hz, height-adjustable stand.',               1899900, 15),
  ('WC-1080-05',  '1080p Webcam',            'Full-HD webcam with dual microphones.',                      249900, 50),
  ('SSD-1TB-06',  '1 TB NVMe SSD',           'PCIe 4.0 SSD, up to 7000 MB/s reads.',                       699900, 35),
  ('HUB-USBC-07', 'USB-C Hub',               '7-in-1 hub: HDMI, 3x USB-A, SD, PD charging.',               199900, 80),
  ('LS-ALU-08',   'Aluminium Laptop Stand',  'Foldable stand, six height settings.',                       149900, 70),
  ('DM-XL-09',    'XL Desk Mat',             '90 x 40 cm stitched-edge desk mat.',                          79900, 100),
  ('CH-65W-10',   '65 W GaN Charger',        'Compact dual-port USB-C charger.',                           259900, 45),
  ('SPK-BT-11',   'Bluetooth Speaker',       'Water-resistant speaker with 12 h playtime.',                349900, 30),
  ('LMP-LED-12',  'LED Desk Lamp',           'Adjustable colour temperature with USB charging port.',      189900, 5)
ON CONFLICT (sku) DO NOTHING;
