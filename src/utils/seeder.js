const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config({ path: __dirname + '/../../.env' });

const seedProviders = [
  {
    fullName: 'ورشة كمال للميكانيك السريع',
    phone: '0550112233',
    password: 'password123',
    role: 'mechanic',
    businessName: 'Garage Kamel Auto Service',
    description: 'صيانة وتصليح جميع أعطال المحركات وأنظمة التبريد والمكابح مع خدمة الطوارئ السريعة',
    address: 'شارع حسيبة بن بوعلي، الجزائر العاصمة',
    location: { type: 'Point', coordinates: [3.0588, 36.7538] },
    brandsSupported: ['Renault', 'Peugeot', 'Dacia', 'Volkswagen', 'Hyundai'],
    workingHours: '08:00 - 18:30 (السبت - الخميس)',
    rating: 4.9,
    reviewsCount: 38,
    isVerified: false,
    hasLocationSet: true,
    services: [
      { title: 'تغيير الزيت والفلاتر (Vidange)', description: 'زيت محرك أصلي 5W40 أو 10W40 مع تغيير فلتر الزيت والهواء', estimatedPrice: 4500 },
      { title: 'فحص وتغيير المكابح (Plaquettes de frein)', description: 'تركيب صفائح المكابح الأمامية والخلفية وضبط الفرامل', estimatedPrice: 3000 },
      { title: 'تغيير حزام التوقيت (Courroie de distribution)', description: 'تغيير لاكوا دو ديستريبيسيون مع البليات والمضخة', estimatedPrice: 12000 }
    ]
  },
  {
    fullName: 'مركز أمين لكهرباء وسكانير السيارات',
    phone: '0555443322',
    password: 'password123',
    role: 'electrician',
    businessName: 'Amine Auto Scanner & Électricité',
    description: 'فحص شامل بالكمبيوتر (Scanner) وكشف الأعطال الكهربائية، برمجة المفاتيح وشحن البطاريات',
    address: 'حي بلكور، الجزائر العاصمة',
    location: { type: 'Point', coordinates: [3.0645, 36.7482] },
    brandsSupported: ['Peugeot', 'Citroen', 'Renault', 'Seat', 'Kia'],
    workingHours: '08:30 - 19:00',
    rating: 4.8,
    reviewsCount: 45,
    isVerified: false,
    hasLocationSet: true,
    services: [
      { title: 'فحص بالسكانير الشامل (Diagnostic Scanner)', description: 'كشف الأعطال الإلكترونية وحذف أكواد الخطأ وفحص الحساسات', estimatedPrice: 2000 },
      { title: 'إصلاح وتبديل الدينامو والمشغل (Démarreur/Alternateur)', description: 'صيانة وشحن المولد الكهربائي وتغيير الفحمات', estimatedPrice: 3500 },
      { title: 'صيانة وإعادة تعبئة غاز المكيف (Climatisation Auto)', description: 'فحص التسريب وتعبئة غاز R134a أصلي', estimatedPrice: 5000 }
    ]
  },
  {
    fullName: 'محل البركة لقطع الغيار الأصلية',
    phone: '0560998877',
    password: 'password123',
    role: 'seller',
    businessName: 'El Baraka Pièces Auto',
    description: 'بيع جميع قطع الغيار الأصلية والمستوردة للسيارات الفرنسية والألمانية مع توفير خدمة التوصيل السريع لـ 58 ولاية',
    address: 'طريق الأربعاء، الكاليتوس، الجزائر',
    location: { type: 'Point', coordinates: [3.1250, 36.6850] },
    brandsSupported: ['Renault', 'Peugeot', 'Volkswagen', 'Toyota', 'Seat', 'Audi'],
    deliveryAvailable: true,
    workingHours: '08:00 - 18:00 (طيلة أيام الأسبوع ما عدا الجمعة)',
    rating: 4.7,
    reviewsCount: 52,
    isVerified: false,
    hasLocationSet: true
  }
];

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/en_panne_db');
    console.log('[Seeder] Connected to MongoDB...');

    // Also update any existing providers in db to hasLocationSet: true
    await User.updateMany(
      { role: { $in: ['mechanic', 'electrician', 'seller'] } },
      { $set: { hasLocationSet: true, isActive: true } }
    );

    for (const p of seedProviders) {
      const exists = await User.findOne({ phone: p.phone });
      if (!exists) {
        await User.create(p);
        console.log(`[Seeder] Created provider: ${p.fullName} (${p.role})`);
      } else {
        await User.updateOne({ phone: p.phone }, { $set: p });
        console.log(`[Seeder] Updated provider: ${p.fullName} (${p.role})`);
      }
    }

    console.log('[Seeder] Seeding finished successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Seeder] Error seeding data:', err);
    process.exit(1);
  }
};

seedData();
