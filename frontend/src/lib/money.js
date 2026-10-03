const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

/** Format integer minor units (paise) as rupees, e.g. 459900 -> "₹4,599.00". */
export const formatMoney = (cents) => inr.format(cents / 100);
