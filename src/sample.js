'use strict';

// Sample services and team per type of business, so a fresh install looks
// alive. Text is in English and Arabic; other languages use English.
// Each service: [key, emoji, minutes, buffer, priceEN, priceAR, staff keys (empty = everyone)]

const TYPES = {
  barber: {
    staff: [['omar', 'Omar', 'Senior barber', 'عمر', 'حلاق أول'], ['karim', 'Karim', 'Barber', 'كريم', 'حلاق']],
    services: [
      ['cut', '💈', 30, 5, 20, 150, []],
      ['beard', '🧔', 20, 5, 12, 80, []],
      ['combo', '✂️', 45, 5, 28, 200, []],
      ['kids', '👦', 25, 5, 15, 100, ['karim']],
      ['shave', '🪒', 30, 10, 18, 120, ['omar']],
    ],
    text: {
      en: { tagline: 'Sharp cuts, hot towels, good vibes', cut: ['Haircut', 'Wash, cut & style'], beard: ['Beard trim', 'Shape-up with clean lines'], combo: ['Haircut + beard', 'The full refresh'], kids: ['Kids cut', 'Under 12'], shave: ['Hot towel shave', 'Classic straight-razor shave'] },
      ar: { tagline: 'قصّات مظبوطة، فوطة سخنة، وجو حلو', cut: ['قص شعر', 'غسيل وقص وتسريحة'], beard: ['تهذيب ذقن', 'تحديد وتظبيط'], combo: ['قص شعر + ذقن', 'الباكدج الكامل'], kids: ['قص شعر أطفال', 'أقل من 12 سنة'], shave: ['حلاقة بالموس والفوطة السخنة', 'الحلاقة الكلاسيك'] },
    },
  },
  salon: {
    staff: [['sara', 'Sara', 'Hair stylist', 'سارة', 'مصففة شعر'], ['nour', 'Nour', 'Nail artist', 'نور', 'خبيرة أظافر']],
    services: [
      ['blow', '💇‍♀️', 45, 10, 30, 250, ['sara']],
      ['color', '🎨', 120, 15, 90, 900, ['sara']],
      ['mani', '💅', 45, 10, 25, 200, ['nour']],
      ['pedi', '🦶', 60, 10, 35, 250, ['nour']],
      ['bridal', '👰', 120, 30, 150, 2500, []],
    ],
    text: {
      en: { tagline: 'Hair, nails & a little bit of magic', blow: ['Blow-dry', 'Wash & bouncy blow-dry'], color: ['Hair colour', 'Full colour or balayage'], mani: ['Gel manicure', 'Long-lasting shine'], pedi: ['Spa pedicure', 'Soak, scrub & polish'], bridal: ['Bridal makeup', 'Trial included'] },
      ar: { tagline: 'شعر وأظافر وشوية سحر', blow: ['سشوار', 'غسيل وسشوار بفوليوم'], color: ['صبغة شعر', 'صبغة كاملة أو بالياج'], mani: ['مانيكير جل', 'لمعة بتعيش'], pedi: ['باديكير سبا', 'نقع وتقشير وطلاء'], bridal: ['ميكب عروسة', 'شامل البروفة'] },
    },
  },
  clinic: {
    staff: [['ahmed', 'Dr. Ahmed', 'Dentist', 'د. أحمد', 'طبيب أسنان'], ['laila', 'Dr. Laila', 'Orthodontist', 'د. ليلى', 'أخصائية تقويم']],
    services: [
      ['consult', '🩺', 30, 5, 40, 300, []],
      ['follow', '📋', 15, 5, 0, 0, []],
      ['clean', '🦷', 45, 10, 70, 500, ['ahmed']],
      ['white', '✨', 60, 10, 200, 2000, ['ahmed']],
      ['ortho', '😁', 30, 5, 60, 400, ['laila']],
    ],
    text: {
      en: { tagline: 'Gentle care for healthy smiles', consult: ['Consultation', 'Check-up and treatment plan'], follow: ['Follow-up', 'For existing patients'], clean: ['Cleaning & polish', 'Scaling and polishing'], white: ['Teeth whitening', 'In-clinic whitening'], ortho: ['Braces check', 'Adjustment visit'] },
      ar: { tagline: 'رعاية لطيفة لابتسامة صحية', consult: ['كشف', 'فحص وخطة علاج'], follow: ['متابعة', 'للمرضى الحاليين'], clean: ['تنظيف وتلميع', 'إزالة الجير والتلميع'], white: ['تبييض أسنان', 'تبييض في العيادة'], ortho: ['متابعة تقويم', 'زيارة ضبط'] },
    },
  },
  coach: {
    staff: [],
    services: [
      ['trial', '👋', 30, 0, 0, 0, []],
      ['pt', '🏋️', 60, 15, 45, 400, []],
      ['online', '💻', 30, 0, 25, 200, []],
      ['nutrition', '🥗', 45, 0, 35, 300, []],
    ],
    text: {
      en: { tagline: 'Stronger every week', trial: ['Free intro session', 'Meet, talk goals, try a workout'], pt: ['Personal training', 'One-to-one session'], online: ['Online check-in', 'Video call'], nutrition: ['Nutrition plan', 'Personalised meal plan'] },
      ar: { tagline: 'أقوى كل أسبوع', trial: ['جلسة تعارف مجانية', 'نتكلم عن هدفك ونجرّب تمرين'], pt: ['تدريب شخصي', 'جلسة فردية'], online: ['متابعة أونلاين', 'مكالمة فيديو'], nutrition: ['نظام غذائي', 'خطة أكل مخصصة ليك'] },
    },
  },
  other: {
    staff: [],
    services: [
      ['consult', '💬', 30, 0, 30, 250, []],
      ['session', '⭐', 60, 10, 60, 500, []],
    ],
    text: {
      en: { tagline: 'Book your appointment online', consult: ['Consultation', '30-minute meeting'], session: ['Full session', 'One hour'] },
      ar: { tagline: 'احجز ميعادك أونلاين', consult: ['استشارة', 'مقابلة نص ساعة'], session: ['جلسة كاملة', 'ساعة'] },
    },
  },
};

function loadSample(store, type, lang) {
  const def = TYPES[type] || TYPES.other;
  const ar = lang === 'ar';
  const text = def.text[ar ? 'ar' : 'en'];
  if (!store.settings.tagline) store.updateSettings({ tagline: text.tagline });
  const staffIds = {};
  for (const [key, enName, enTitle, arName, arTitle] of def.staff) {
    const m = store.add('staff', { name: ar ? arName : enName, title: ar ? arTitle : enTitle, photo: '', active: true, hours: null }, { save: false });
    staffIds[key] = m.id;
  }
  for (const [key, emoji, duration, buffer, priceEn, priceAr, who] of def.services) {
    const [name, description] = text[key];
    store.add(
      'services',
      { name, description, emoji, duration, buffer, price: ar ? priceAr : priceEn, active: true, staffIds: who.map((k) => staffIds[k]) },
      { save: false }
    );
  }
  store.save();
}

module.exports = { loadSample, BUSINESS_TYPES: Object.keys(TYPES) };
