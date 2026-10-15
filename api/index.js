const connectToDatabase = require('../db');
const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  studentName: String,
  subjectName: String,
  course: String,
  attendance: [{ _id: false, date: Date }]
}, { collection: 'daily_attendance' });

const Attendance =
  mongoose.models.Attendance || mongoose.model('Attendance', AttendanceSchema);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await connectToDatabase();

    if (req.method === 'GET') {
      const records = await Attendance.find({})
        .sort({ course: 1, subjectName: 1, studentName: 1 });
      return res.status(200).json(records);
    }

    if (req.method === 'POST') {
      const { studentName, subjectName, course, date } = req.body || {};
      const when = new Date(date);
      if (!studentName || !subjectName || !course || isNaN(when)) {
        return res.status(400).json({
          error: 'studentName, subjectName, course and a valid date are required'
        });
      }
      const updated = await Attendance.findOneAndUpdate(
        {
          studentName: String(studentName).trim(),
          subjectName: String(subjectName).trim(),
          course: String(course).trim()
        },
        { $addToSet: { attendance: { date: when } } },
        { upsert: true, new: true }
      );
      return res.status(201).json(updated);
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Database connection failed' });
  }
};