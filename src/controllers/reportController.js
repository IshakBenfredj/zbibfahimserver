const Report = require('../models/Report');

// @desc    Submit a new dispute or report
// @route   POST /api/reports
// @access  Private
exports.createReport = async (req, res, next) => {
  try {
    const { reportedUser, reportedRequest, type, title, details, images } = req.body;

    if (!title || !title.trim() || !details || !details.trim()) {
      return res.status(400).json({
        success: false,
        message: 'عنوان الشكوى والتفاصيل مطلوبة'
      });
    }

    const report = await Report.create({
      reporter: req.user._id,
      reportedUser: reportedUser || null,
      reportedRequest: reportedRequest || null,
      type: type || 'other',
      title: title.trim(),
      details: details.trim(),
      images: Array.isArray(images) ? images : []
    });

    res.status(201).json({
      success: true,
      message: 'تم إرسال بلاغك بنجاح وسيقوم فريق الإدارة بمراجعته',
      data: report
    });
  } catch (err) {
    next(err);
  }
};
