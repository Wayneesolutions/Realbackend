// src/utils/phone.js
//
// Normalises a phone number to E.164, defaulting to +91 (India) when no
// country code is present — matches the Tech Stack doc's lead-dedup rule
// (Ch.11.6: "normalises the phone number (E.164 format, country-code aware
// for +91)"). This is intentionally simple (no libphonenumber dependency);
// revisit if the platform ever needs non-Indian dealers.

function normalizePhone(rawPhone) {
  if (!rawPhone) return null;

  const digitsOnly = String(rawPhone).replace(/[^\d+]/g, '');

  if (digitsOnly.startsWith('+')) {
    return digitsOnly;
  }

  // 91XXXXXXXXXX already has the country code, just missing '+'
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return `+${digitsOnly}`;
  }

  // Bare 10-digit Indian mobile number
  if (digitsOnly.length === 10) {
    return `+91${digitsOnly}`;
  }

  // Anything else: return as-is with a leading '+' so it's at least
  // consistently stored; not guaranteed valid.
  return `+${digitsOnly}`;
}

// wa.me deep links want digits only, no leading '+'
function toWaMeDigits(e164Phone) {
  if (!e164Phone) return null;
  return e164Phone.replace(/^\+/, '');
}

module.exports = { normalizePhone, toWaMeDigits };
