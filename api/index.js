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

const clean = (v) => String(v || '').trim();

const MAX_PAST_DAYS = 30; // how far back a date may be; keep the same as the frontend

function dateProblem(d, checkOldest) {
  if (isNaN(d)) return 'Invalid date';
  const key = d.toISOString().slice(0, 10);
  const DAY = 24 * 3600 * 1000;
  // allow up to 14 hours ahead so users east of UTC (like the Philippines) can pick their "today"
  const newest = new Date(Date.now() + 14 * 3600 * 1000).toISOString().slice(0, 10);
  if (key > newest) return 'Dates in the future are not allowed';
  if (checkOldest) {
    // one extra day of slack for time zone differences
    const oldest = new Date(Date.now() - (MAX_PAST_DAYS + 1) * DAY).toISOString().slice(0, 10);
    if (key < oldest) return 'That date is more than ' + MAX_PAST_DAYS + ' days ago';
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await connectToDatabase();

    // READ: list all students
    if (req.method === 'GET') {
      const records = await Attendance.find({})
        .sort({ course: 1, subjectName: 1, studentName: 1 });
      return res.status(200).json(records);
    }

    // CREATE / ADD A DATE
    if (req.method === 'POST') {
      const { studentName, subjectName, course, date } = req.body || {};
      const when = new Date(date);
      if (!studentName || !subjectName || !course || isNaN(when)) {
        return res.status(400).json({
          error: 'studentName, subjectName, course and a valid date are required'
        });
      }
      const problem = dateProblem(when, true);
      if (problem) return res.status(400).json({ error: problem });

      const updated = await Attendance.findOneAndUpdate(
        {
          studentName: clean(studentName),
          subjectName: clean(subjectName),
          course: clean(course)
        },
        { $addToSet: { attendance: { date: when } } },
        { upsert: true, returnDocument: 'after' }
      );
      return res.status(201).json(updated);
    }

    // EDIT: fix name/subject/course and the list of dates
    if (req.method === 'PATCH') {
      const { id } = req.query;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid student id' });
      }
      const body = req.body || {};
      const studentName = clean(body.studentName);
      const subjectName = clean(body.subjectName);
      const course = clean(body.course);
      if (!studentName || !subjectName || !course) {
        return res.status(400).json({
          error: 'studentName, subjectName and course are required'
        });
      }
      const dates = Array.isArray(body.dates) ? body.dates.map(d => new Date(d)) : null;
      if (!dates || dates.some(d => isNaN(d))) {
        return res.status(400).json({ error: 'dates must be a list of valid dates' });
      }
      // Future dates are never allowed. The "too old" check is skipped here so
      // editing a name does not fail because of older existing dates.
      const badDate = dates.map(d => dateProblem(d, false)).find(Boolean);
      if (badDate) return res.status(400).json({ error: badDate });

      const unique = [...new Map(dates.map(d => [d.getTime(), d])).values()]
        .sort((a, b) => a - b);

      const current = await Attendance.findById(id);
      if (!current) return res.status(404).json({ error: 'Student not found' });

      // If the corrected details match another student, merge into that one
      const duplicate = await Attendance.findOne({
        _id: { $ne: id }, studentName, subjectName, course
      });
      if (duplicate) {
        await Attendance.updateOne(
          { _id: duplicate._id },
          { $addToSet: { attendance: { $each: unique.map(date => ({ date })) } } }
        );
        await Attendance.deleteOne({ _id: id });
        const merged = await Attendance.findById(duplicate._id);
        return res.status(200).json({ merged: true, record: merged });
      }

      current.studentName = studentName;
      current.subjectName = subjectName;
      current.course = course;
      current.attendance = unique.map(date => ({ date }));
      await current.save();
      return res.status(200).json({ merged: false, record: current });
    }

    // DELETE: a whole student, or one date if ?date= is given
    if (req.method === 'DELETE') {
      const { id, date } = req.query;
      if (!mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid student id' });
      }
      if (date) {
        const when = new Date(date);
        if (isNaN(when)) return res.status(400).json({ error: 'Invalid date' });
        const updated = await Attendance.findByIdAndUpdate(
          id,
          { $pull: { attendance: { date: when } } },
          { returnDocument: 'after' }
        );
        if (!updated) return res.status(404).json({ error: 'Student not found' });
        return res.status(200).json(updated);
      }
      const removed = await Attendance.findByIdAndDelete(id);
      if (!removed) return res.status(404).json({ error: 'Student not found' });
      return res.status(200).json({ deleted: true });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Database connection failed' });
  }
};