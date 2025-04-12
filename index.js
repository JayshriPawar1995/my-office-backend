require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://Office:${process.env.DB_PASS}@cluster0.rabv0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server
    console.log('Connecting to MongoDB...');
    const UserCollection = client.db('Office').collection('User');
    const AttendanceCollection = client.db('Office').collection('Attendance');
    const SalesCollection = client.db('Office').collection('Sales');
    const TargetsCollection = client.db('Office').collection('Targets');
    const TasksCollection = client.db('Office').collection('Tasks');
    const LeaveCollection = client.db('Office').collection('Leave');
    const LocationChangeCollection = client.db('Office').collection('LocationChange');
    const JobPostCollection = client.db('Office').collection('Jobs');
    const JobApplicationCollection = client.db('Office').collection('JobApplications');
    cron.schedule('1 17 * * 1-5', async () => {
      console.log('Running auto check-out job');
      try {
        const today = new Date().toISOString().split('T')[0];
        const needCheckOut = await AttendanceCollection.find({
          date: today,
          checkInTime: { $exists: true },
          checkOutTime: { $exists: false },
        }).toArray();
        console.log(`Found ${needCheckOut.length} users who need auto check-out`);
        const endOfDay = new Date();
        endOfDay.setHours(17, 0, 0, 0);
        for (const record of needCheckOut) {
          const checkIn = new Date(record.checkInTime);
          const checkOut = endOfDay;
          const diffMs = checkOut - checkIn;
          const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
          const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          const workHours = `${diffHrs}h ${diffMins}m`;
          await AttendanceCollection.updateOne(
            { _id: record._id },
            {
              $set: {
                checkOutTime: endOfDay.toISOString(),
                workHours: workHours,
                autoCheckOut: true,
                checkOutLocation: record.lastLocation || record.location || 'Office', // Use last known location
              },
            }
          );
        }
      } catch (error) {
        console.error('Error in auto check-out process:', error);
      }
    });
    cron.schedule('1 17 * * 1-5', async () => {
      console.log('Running absent marking job');
      try {
        const today = new Date().toISOString().split('T')[0];
        const allUsers = await UserCollection.find({
          status: 'approved',
        }).toArray();
        console.log(`Checking ${allUsers.length} users for absence`);
        for (const user of allUsers) {
          const hasRecord = await AttendanceCollection.findOne({
            userEmail: user.emailAddress,
            date: today,
          });
          if (!hasRecord) {
            console.log(`Marking ${user.fullName} (${user.emailAddress}) as absent`);
            await AttendanceCollection.insertOne({
              userEmail: user.emailAddress,
              userName: user.fullName || 'Unknown',
              userRole: user.userRole,
              date: today,
              status: 'absent',
              location: 'N/A',
              notes: 'Automatically marked absent',
              timestamp: new Date().toISOString(),
              autoAbsent: true,
            });
          }
        }
      } catch (error) {
        console.error('Error in absent marking process:', error);
      }
    });
    app.get('/users', async (req, res) => {
      try {
        const email = req.query.email;
        if (email) {
          const result = await UserCollection.find({ emailAddress: email }).toArray();
          return res.send(result);
        }
        const result = await UserCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/users/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await UserCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.post('/users', async (req, res) => {
      try {
        const user = req.body;
        const result = await UserCollection.insertOne(user);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.put('/users/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const options = { upsert: true };
        const updatedUser = req.body;
        delete updatedUser._id;
        const updateDoc = {
          $set: updatedUser,
        };

        const result = await UserCollection.updateOne(filter, updateDoc, options);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.delete('/users/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await UserCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.put('/users/approve/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { userRole } = req.body;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            userRole,
            status: 'approved',
          },
        };

        const result = await UserCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/user-by-email', async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }

        const user = await UserCollection.findOne({ emailAddress: email });
        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }

        res.send(user);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/attendance/status', async (req, res) => {
      try {
        const { email, date } = req.query;
        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }
        const today = date || new Date().toISOString().split('T')[0];
        const attendance = await AttendanceCollection.findOne({
          userEmail: email,
          date: today,
        });
        if (!attendance) {
          const now = new Date();
          const workdayEnd = new Date();
          workdayEnd.setUTCHours(17, 0, 0, 0);
          const beforeMidnight = new Date();
          beforeMidnight.setUTCHours(23, 59, 59, 999);
          if (now > workdayEnd && now < beforeMidnight) {
            const user = await UserCollection.findOne({ emailAddress: email });
            if (user && user.status === 'approved') {
              const absentRecord = {
                userEmail: email,
                userName: user.fullName || 'Unknown',
                userRole: user.userRole,
                date: today,
                status: 'absent',
                location: 'N/A',
                notes: 'Automatically marked absent (end of day)',
                timestamp: new Date().toISOString(),
                autoAbsent: true,
                checkInTime: new Date().toISOString(),
              };
              const result = await AttendanceCollection.insertOne(absentRecord);
              return res.send({
                isCheckedIn: true,
                status: 'absent',
                autoAbsent: true,
                _id: result.insertedId,
                ...absentRecord,
              });
            }
          }
          return res.send({ isCheckedIn: false });
        }
        const locationChanges = await LocationChangeCollection.find({
          userEmail: email,
          date: today,
        })
          .sort({ timestamp: 1 })
          .toArray();
        const isAbsent = attendance.status === 'absent';
        res.send({
          isCheckedIn: true,
          checkInTime: attendance.checkInTime,
          checkOutTime: attendance.checkOutTime || null,
          isCheckedOut: !!attendance.checkOutTime,
          location: attendance.location,
          notes: attendance.notes,
          isOutsideOffice: attendance.isOutsideOffice,
          status: attendance.status || 'present',
          locationChanges: locationChanges || [],
          lastLocation: attendance.lastLocation || attendance.location,
          checkOutLocation: attendance.checkOutLocation,
        });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/attendance/check-auto-absent', async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        const workdayEnd = new Date(now);
        workdayEnd.setHours(17, 0, 0, 0);
        if (now > workdayEnd) {
          const existingRecord = await AttendanceCollection.findOne({
            userEmail: email,
            date: today,
          });
          if (!existingRecord) {
            const user = await UserCollection.findOne({ emailAddress: email });
            if (user && user.status === 'approved') {
              const absentRecord = {
                userEmail: email,
                userName: user.fullName || 'Unknown',
                userRole: user.userRole,
                date: today,
                status: 'absent',
                location: 'N/A',
                notes: 'Automatically marked absent (end of day)',
                timestamp: new Date().toISOString(),
                autoAbsent: true,
              };
              const result = await AttendanceCollection.insertOne(absentRecord);
              return res.send({
                marked: true,
                message: 'User automatically marked as absent',
                record: {
                  _id: result.insertedId,
                  ...absentRecord,
                },
              });
            }
          }
        }

        res.send({ marked: false });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/attendance-by-month', async (req, res) => {
      try {
        const { startDate, endDate } = req.query;
        const end = endDate ? new Date(endDate) : new Date();
        const start = startDate ? new Date(startDate) : new Date(end);
        start.setMonth(start.getMonth() - 5);
        const startStr = start.toISOString().split('T')[0];
        const endStr = end.toISOString().split('T')[0];
        const AttendanceCollection = req.app.locals.client.db('Office').collection('Attendance');
        const attendanceData = await AttendanceCollection.find({
          date: { $gte: startStr, $lte: endStr },
        }).toArray();
        const monthlyData = {};
        attendanceData.forEach((entry) => {
          if (!entry.date) return;
          const [year, month] = entry.date.split('-');
          const monthKey = `${year}-${month}`;
          if (!monthlyData[monthKey]) {
            const monthDate = new Date(Number.parseInt(year), Number.parseInt(month) - 1, 1);
            monthlyData[monthKey] = {
              month: monthDate.toLocaleString('default', { month: 'short' }),
              year: Number.parseInt(year),
              monthNum: Number.parseInt(month),
              present: 0,
              absent: 0,
              late: 0,
              total: 0,
            };
          }
          monthlyData[monthKey].total++;
          if (entry.status === 'present') {
            monthlyData[monthKey].present++;
            if (entry.checkInTime) {
              const checkInHour = new Date(entry.checkInTime).getHours();
              if (checkInHour >= 10) {
                monthlyData[monthKey].late++;
              }
            }
          } else if (entry.status === 'absent') {
            monthlyData[monthKey].absent++;
          }
        });
        const result = Object.values(monthlyData).sort((a, b) => {
          if (a.year !== b.year) return a.year - b.year;
          return a.monthNum - b.monthNum;
        });
        res.send(result);
      } catch (error) {
        console.error('Error fetching attendance by month:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.post('/attendance/check-in', async (req, res) => {
      try {
        const { userEmail, userName, userRole, checkInTime, isOutsideOffice, location, locationType, notes, status } =
          req.body;
        if (!userEmail || !userName || !checkInTime) {
          return res.status(400).send({ message: 'Required fields missing' });
        }
        const date = new Date(checkInTime).toISOString().split('T')[0];
        const existingAttendance = await AttendanceCollection.findOne({
          userEmail,
          date,
        });

        if (existingAttendance) {
          if (status === 'absent') {
            const filter = { _id: new ObjectId(existingAttendance._id) };
            const updateDoc = {
              $set: {
                status: 'absent',
                notes: notes || 'Automatically marked absent',
                timestamp: new Date().toISOString(),
                autoAbsent: true,
              },
            };
            const result = await AttendanceCollection.updateOne(filter, updateDoc);
            return res.send({
              acknowledged: true,
              modifiedCount: result.modifiedCount,
              message: 'Updated existing record to absent',
            });
          }

          return res.status(400).send({ message: 'Already checked in today' });
        }
        const attendance = {
          userEmail,
          userName,
          userRole,
          date,
          checkInTime,
          isOutsideOffice: isOutsideOffice || false,
          location: location || 'Office',
          locationType: locationType || 'office',
          notes: notes || '',
          status: status || 'present',
          timestamp: new Date().toISOString(),
          lastLocation: location || 'Office',
          isCheckedIn: true,
        };
        const result = await AttendanceCollection.insertOne(attendance);
        await LocationChangeCollection.insertOne({
          userEmail,
          userName,
          date,
          timestamp: checkInTime,
          location: location || 'Office',
          locationType: locationType || 'office',
          isOutsideOffice: isOutsideOffice || false,
          notes: notes || 'Initial check-in',
          type: 'check-in',
        });

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.put('/attendance/check-out', async (req, res) => {
      try {
        const { userEmail, checkOutTime, date, location, locationType, notes } = req.body;
        if (!userEmail || !checkOutTime) {
          return res.status(400).send({ message: 'Required fields missing' });
        }
        const today = date || new Date(checkOutTime).toISOString().split('T')[0];
        const attendance = await AttendanceCollection.findOne({
          userEmail,
          date: today,
        });
        if (!attendance) {
          return res.status(404).send({ message: 'No check-in record found for today' });
        }
        const checkIn = new Date(attendance.checkInTime);
        const checkOut = new Date(checkOutTime);
        const diffMs = checkOut - checkIn;
        const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const workHours = `${diffHrs}h ${diffMins}m`;
        const filter = { _id: new ObjectId(attendance._id) };
        const updateDoc = {
          $set: {
            checkOutTime,
            workHours,
            checkOutLocation: location || attendance.lastLocation || attendance.location,
            checkOutLocationType: locationType || attendance.locationType,
            checkOutNotes: notes || '',
          },
        };
        const result = await AttendanceCollection.updateOne(filter, updateDoc);
        await LocationChangeCollection.insertOne({
          userEmail,
          userName: attendance.userName,
          date: today,
          timestamp: checkOutTime,
          location: location || attendance.lastLocation || attendance.location,
          locationType: locationType || attendance.locationType || 'office',
          isOutsideOffice: location !== 'Office',
          notes: notes || 'Check-out',
          type: 'check-out',
        });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.post('/attendance/location-change', async (req, res) => {
      try {
        const { userEmail, userName, timestamp, location, locationType, notes, isOutsideOffice } = req.body;

        if (!userEmail || !timestamp || !location) {
          return res.status(400).send({ message: 'Required fields missing' });
        }
        const date = new Date(timestamp).toISOString().split('T')[0];
        const attendance = await AttendanceCollection.findOne({
          userEmail,
          date,
        });

        if (!attendance) {
          return res.status(400).send({ message: 'You must check in first before changing location' });
        }
        if (attendance.checkOutTime) {
          return res.status(400).send({ message: 'Cannot change location after checking out' });
        }
        const locationChange = {
          userEmail,
          userName: userName || attendance.userName,
          date,
          timestamp,
          location,
          locationType: locationType || 'other',
          isOutsideOffice: isOutsideOffice || location !== 'Office',
          notes: notes || '',
          type: 'location-change',
        };
        const result = await LocationChangeCollection.insertOne(locationChange);
        await AttendanceCollection.updateOne(
          { _id: attendance._id },
          {
            $set: {
              lastLocation: location,
              lastLocationType: locationType || 'other',
            },
          }
        );
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/attendance/location-changes', async (req, res) => {
      try {
        const { email, date } = req.query;

        if (!email || !date) {
          return res.status(400).send({ message: 'Email and date are required' });
        }

        const locationChanges = await LocationChangeCollection.find({
          userEmail: email,
          date,
        })
          .sort({ timestamp: 1 })
          .toArray();

        res.send(locationChanges);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/attendance/history', async (req, res) => {
      try {
        const { email, startDate, endDate } = req.query;

        if (!email) {
          return res.status(400).send({ message: 'Email is required' });
        }
        const query = { userEmail: email };
        if (startDate && endDate) {
          query.date = { $gte: startDate, $lte: endDate };
        } else if (startDate) {
          query.date = { $gte: startDate };
        } else if (endDate) {
          query.date = { $lte: endDate };
        }
        const result = await AttendanceCollection.find(query).sort({ date: -1 }).toArray();
        for (const record of result) {
          const locationChanges = await LocationChangeCollection.find({
            userEmail: email,
            date: record.date,
          })
            .sort({ timestamp: 1 })
            .toArray();

          record.locationChanges = locationChanges;
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/attendance/all', async (req, res) => {
      try {
        const { date, status } = req.query;
        const query = {};
        if (date) {
          query.date = date;
        }
        if (status && status !== 'all') {
          if (status === 'remote') {
            query.isOutsideOffice = true;
          } else {
            query.status = status;
          }
        }
        const result = await AttendanceCollection.find(query).sort({ date: -1 }).toArray();
        for (const record of result) {
          const locationChanges = await LocationChangeCollection.find({
            userEmail: record.userEmail,
            date: record.date,
          })
            .sort({ timestamp: 1 })
            .toArray();

          record.locationChanges = locationChanges;
        }
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.post('/attendance/mark-absent', async (req, res) => {
      try {
        const { date } = req.body;
        const targetDate = date || new Date().toISOString().split('T')[0];
        const allUsers = await UserCollection.find({
          userRole: { $ne: 'user' },
          status: 'approved',
        }).toArray();
        const results = [];
        for (const user of allUsers) {
          const hasRecord = await AttendanceCollection.findOne({
            userEmail: user.emailAddress,
            date: targetDate,
          });
          if (!hasRecord) {
            const result = await AttendanceCollection.insertOne({
              userEmail: user.emailAddress,
              userName: user.fullName || 'Unknown',
              userRole: user.userRole,
              date: targetDate,
              status: 'absent',
              location: 'N/A',
              notes: 'Marked absent',
              timestamp: new Date().toISOString(),
            });
            results.push({ user: user.emailAddress, result });
          }
        }

        res.send({ message: `Marked ${results.length} users as absent`, results });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.patch('/attend/auto-out', async (req, res) => {
      try {
        const { userEmail, date } = req.body;
        if (!userEmail) {
          return res.status(400).send({ message: 'User email is required' });
        }
        const today = date || new Date().toISOString().split('T')[0];
        const attendance = await AttendanceCollection.findOne({
          userEmail,
          date: today,
          status: 'absent',
        });

        if (!attendance) {
          return res.status(404).send({ message: 'No absent record found for this user today' });
        }
        if (attendance.checkOutTime) {
          return res.send({ message: 'User already checked out', alreadyCheckedOut: true });
        }
        const checkOutTime = new Date().toISOString();
        const filter = { _id: new ObjectId(attendance._id) };
        const updateDoc = {
          $set: {
            checkOutTime: checkOutTime,
            workHours: '0h 0m',
            checkOutLocation: attendance.location || 'N/A',
            checkOutNotes: 'Auto checkout for absent user',
            autoCheckOut: true,
          },
        };
        const result = await AttendanceCollection.updateOne(filter, updateDoc);
        await LocationChangeCollection.insertOne({
          userEmail,
          userName: attendance.userName,
          date: today,
          timestamp: checkOutTime,
          location: attendance.location || 'N/A',
          locationType: attendance.locationType || 'other',
          isOutsideOffice: false,
          notes: 'Auto checkout for absent user',
          type: 'check-out',
        });

        res.send({ message: 'Auto checkout completed', result });
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/sales', async (req, res) => {
      try {
        const { userEmail, startDate, endDate } = req.query;

        if (!userEmail) {
          return res.status(400).send({ message: 'User email is required' });
        }
        const query = { userEmail };
        if (startDate && endDate) {
          query.date = { $gte: startDate, $lte: endDate };
        } else if (startDate) {
          query.date = { $gte: startDate };
        } else if (endDate) {
          query.date = { $lte: endDate };
        }
        const result = await SalesCollection.find(query).sort({ date: -1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.post('/sales', async (req, res) => {
      try {
        const {
          userEmail,
          userName,
          userRole,
          date,
          savingsAccountOpened,
          savingsAccountDeposit,
          praAccountOpened,
          praAccountDeposit,
          currentAccountOpened,
          currentAccountDeposit,
          sndAccountOpened,
          sndAccountDeposit,
          fdrTermAccountOpened,
          fdrTermDeposit,
          dpsAccountOpened,
          dpsDeposit,
          loans,
          qrOnboarding,
          apps,
          cardActivations,
          todayDeposit,
          todayNetDeposit,
          totalDeposit,
          totalAccounts,
          totalQR,
          dayEndHandCash,
          dayEndMotherBalance,
          agentBoothName,
          notes,
        } = req.body;

        if (!userEmail || !date) {
          return res.status(400).send({ message: 'Required fields missing' });
        }
        const existingEntry = await SalesCollection.findOne({
          userEmail,
          date,
        });
        if (existingEntry) {
          return res.status(400).send({ message: 'Sales entry already exists for this date' });
        }
        const calculatedTodayDeposit =
          Number(savingsAccountDeposit || 0) +
          Number(praAccountDeposit || 0) +
          Number(currentAccountDeposit || 0) +
          Number(sndAccountDeposit || 0) +
          Number(fdrTermDeposit || 0) +
          Number(dpsDeposit || 0);
        const calculatedTotalAccounts =
          Number(savingsAccountOpened || 0) +
          Number(praAccountOpened || 0) +
          Number(currentAccountOpened || 0) +
          Number(sndAccountOpened || 0) +
          Number(fdrTermAccountOpened || 0) +
          Number(dpsAccountOpened || 0);

        const salesEntry = {
          userEmail,
          userName,
          userRole,
          date,
          savingsAccountOpened: Number(savingsAccountOpened) || 0,
          savingsAccountDeposit: Number(savingsAccountDeposit) || 0,
          praAccountOpened: Number(praAccountOpened) || 0,
          praAccountDeposit: Number(praAccountDeposit) || 0,
          currentAccountOpened: Number(currentAccountOpened) || 0,
          currentAccountDeposit: Number(currentAccountDeposit) || 0,
          sndAccountOpened: Number(sndAccountOpened) || 0,
          sndAccountDeposit: Number(sndAccountDeposit) || 0,
          fdrTermAccountOpened: Number(fdrTermAccountOpened) || 0,
          fdrTermDeposit: Number(fdrTermDeposit) || 0,
          dpsAccountOpened: Number(dpsAccountOpened) || 0,
          dpsDeposit: Number(dpsDeposit) || 0,
          loans: Number(loans) || 0,
          qrOnboarding: Number(qrOnboarding) || 0,
          apps: Number(apps) || 0,
          cardActivations: Number(cardActivations) || 0,
          todayDeposit: Number(todayDeposit) || calculatedTodayDeposit,
          todayNetDeposit: Number(todayNetDeposit) || 0,
          totalDeposit: Number(totalDeposit) || 0,
          totalAccounts: Number(totalAccounts) || calculatedTotalAccounts,
          totalQR: Number(totalQR) || 0,
          dayEndHandCash: Number(dayEndHandCash) || 0,
          dayEndMotherBalance: Number(dayEndMotherBalance) || 0,
          agentBoothName: agentBoothName || '',
          notes: notes || '',
          timestamp: new Date().toISOString(),
        };
        const result = await SalesCollection.insertOne(salesEntry);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.put('/sales/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const {
          savingsAccountOpened,
          savingsAccountDeposit,
          praAccountOpened,
          praAccountDeposit,
          currentAccountOpened,
          currentAccountDeposit,
          sndAccountOpened,
          sndAccountDeposit,
          fdrTermAccountOpened,
          fdrTermDeposit,
          dpsAccountOpened,
          dpsDeposit,
          loans,
          qrOnboarding,
          apps,
          cardActivations,
          todayDeposit,
          todayNetDeposit,
          totalDeposit,
          totalAccounts,
          totalQR,
          dayEndHandCash,
          dayEndMotherBalance,
          agentBoothName,
          notes,
        } = req.body;
        const calculatedTodayDeposit =
          Number(savingsAccountDeposit || 0) +
          Number(praAccountDeposit || 0) +
          Number(currentAccountDeposit || 0) +
          Number(sndAccountDeposit || 0) +
          Number(fdrTermDeposit || 0) +
          Number(dpsDeposit || 0);
        const calculatedTotalAccounts =
          Number(savingsAccountOpened || 0) +
          Number(praAccountOpened || 0) +
          Number(currentAccountOpened || 0) +
          Number(sndAccountOpened || 0) +
          Number(fdrTermAccountOpened || 0) +
          Number(dpsAccountOpened || 0);

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            savingsAccountOpened: Number(savingsAccountOpened) || 0,
            savingsAccountDeposit: Number(savingsAccountDeposit) || 0,
            praAccountOpened: Number(praAccountOpened) || 0,
            praAccountDeposit: Number(praAccountDeposit) || 0,
            currentAccountOpened: Number(currentAccountOpened) || 0,
            currentAccountDeposit: Number(currentAccountDeposit) || 0,
            sndAccountOpened: Number(sndAccountOpened) || 0,
            sndAccountDeposit: Number(sndAccountDeposit) || 0,
            fdrTermAccountOpened: Number(fdrTermAccountOpened) || 0,
            fdrTermDeposit: Number(fdrTermDeposit) || 0,
            dpsAccountOpened: Number(dpsAccountOpened) || 0,
            dpsDeposit: Number(dpsDeposit) || 0,
            loans: Number(loans) || 0,
            qrOnboarding: Number(qrOnboarding) || 0,
            apps: Number(apps) || 0,
            cardActivations: Number(cardActivations) || 0,
            todayDeposit: Number(todayDeposit) || calculatedTodayDeposit,
            todayNetDeposit: Number(todayNetDeposit) || 0,
            totalDeposit: Number(totalDeposit) || 0,
            totalAccounts: Number(totalAccounts) || calculatedTotalAccounts,
            totalQR: Number(totalQR) || 0,
            dayEndHandCash: Number(dayEndHandCash) || 0,
            dayEndMotherBalance: Number(dayEndMotherBalance) || 0,
            agentBoothName: agentBoothName || '',
            notes: notes || '',
            updatedAt: new Date().toISOString(),
          },
        };

        const result = await SalesCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.delete('/sales/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await SalesCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/sales/all', async (req, res) => {
      try {
        const { startDate, endDate, userRole } = req.query;
        const query = {};
        if (startDate && endDate) {
          query.date = { $gte: startDate, $lte: endDate };
        } else if (startDate) {
          query.date = { $gte: startDate };
        } else if (endDate) {
          query.date = { $lte: endDate };
        }
        if (userRole) {
          query.userRole = userRole;
        }
        const result = await SalesCollection.find(query).sort({ date: -1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/targets', async (req, res) => {
      try {
        const { userEmail, managerEmail, month, year } = req.query;
        const query = {};
        if (userEmail) {
          query.userEmail = userEmail;
        }
        if (managerEmail) {
          query.managerEmail = managerEmail;
        }
        if (month && year) {
          query.month = Number.parseInt(month);
          query.year = Number.parseInt(year);
        }

        const result = await TargetsCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });

    app.post('/targets', async (req, res) => {
      try {
        const {
          userEmail,
          userName,
          userRole,
          managerEmail,
          managerName,
          month,
          year,
          savingsAccountTarget,
          praAccountTarget,
          currentAccountTarget,
          sndAccountTarget,
          fdrTermAccountTarget,
          dpsAccountTarget,
          depositsTarget,
          loansTarget,
          qrOnboardingTarget,
          appsTarget,
          cardActivationsTarget,
          notes,
        } = req.body;
        const existingTarget = await TargetsCollection.findOne({
          userEmail,
          month,
          year,
        });

        if (existingTarget) {
          return res.status(400).send({ message: 'Target already exists for this month' });
        }

        const target = {
          userEmail,
          userName,
          userRole,
          managerEmail,
          managerName,
          month,
          year,
          savingsAccountTarget: Number(savingsAccountTarget) || 0,
          praAccountTarget: Number(praAccountTarget) || 0,
          currentAccountTarget: Number(currentAccountTarget) || 0,
          sndAccountTarget: Number(sndAccountTarget) || 0,
          fdrTermAccountTarget: Number(fdrTermAccountTarget) || 0,
          dpsAccountTarget: Number(dpsAccountTarget) || 0,
          depositsTarget: Number(depositsTarget) || 0,
          loansTarget: Number(loansTarget) || 0,
          qrOnboardingTarget: Number(qrOnboardingTarget) || 0,
          appsTarget: Number(appsTarget) || 0,
          cardActivationsTarget: Number(cardActivationsTarget) || 0,
          notes: notes || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = await TargetsCollection.insertOne(target);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.put('/targets/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const {
          savingsAccountTarget,
          praAccountTarget,
          currentAccountTarget,
          sndAccountTarget,
          fdrTermAccountTarget,
          dpsAccountTarget,
          depositsTarget,
          loansTarget,
          qrOnboardingTarget,
          appsTarget,
          cardActivationsTarget,
          notes,
        } = req.body;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            savingsAccountTarget: Number(savingsAccountTarget) || 0,
            praAccountTarget: Number(praAccountTarget) || 0,
            currentAccountTarget: Number(currentAccountTarget) || 0,
            sndAccountTarget: Number(sndAccountTarget) || 0,
            fdrTermAccountTarget: Number(fdrTermAccountTarget) || 0,
            dpsAccountTarget: Number(dpsAccountTarget) || 0,
            depositsTarget: Number(depositsTarget) || 0,
            loansTarget: Number(loansTarget) || 0,
            qrOnboardingTarget: Number(qrOnboardingTarget) || 0,
            appsTarget: Number(appsTarget) || 0,
            cardActivationsTarget: Number(cardActivationsTarget) || 0,
            notes: notes || '',
            updatedAt: new Date().toISOString(),
          },
        };

        const result = await TargetsCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.delete('/targets/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await TargetsCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/team-performance', async (req, res) => {
      try {
        const { managerEmail, month, year } = req.query;

        if (!managerEmail || !month || !year) {
          return res.status(400).send({ message: 'Manager email, month, and year are required' });
        }
        const targets = await TargetsCollection.find({
          managerEmail,
          month: Number.parseInt(month),
          year: Number.parseInt(year),
        }).toArray();

        console.log(`Found ${targets.length} targets for manager ${managerEmail}`);

        if (targets.length === 0) {
          return res.status(404).send({ message: 'No targets found for this month' });
        }
        const teamPerformance = [];

        for (const target of targets) {
          const startDate = new Date(Number.parseInt(year), Number.parseInt(month) - 1, 1).toISOString().split('T')[0];
          const endDate = new Date(Number.parseInt(year), Number.parseInt(month), 0).toISOString().split('T')[0];

          const salesEntries = await SalesCollection.find({
            userEmail: target.userEmail,
            date: { $gte: startDate, $lte: endDate },
          }).toArray();
          const achievements = {
            savingsAccountOpened: 0,
            praAccountOpened: 0,
            currentAccountOpened: 0,
            sndAccountOpened: 0,
            fdrTermAccountOpened: 0,
            dpsAccountOpened: 0,
            savingsDeposit: 0,
            praDeposit: 0,
            currentDeposit: 0,
            sndDeposit: 0,
            fdrTermDeposit: 0,
            dpsDeposit: 0,
            totalDeposit: 0,
            loans: 0,
            qrOnboarding: 0,
            apps: 0,
            cardActivations: 0,
          };

          salesEntries.forEach((entry) => {
            achievements.savingsAccountOpened += entry.savingsAccountOpened || 0;
            achievements.praAccountOpened += entry.praAccountOpened || 0;
            achievements.currentAccountOpened += entry.currentAccountOpened || 0;
            achievements.sndAccountOpened += entry.sndAccountOpened || 0;
            achievements.fdrTermAccountOpened += entry.fdrTermAccountOpened || 0;
            achievements.dpsAccountOpened += entry.dpsAccountOpened || 0;
            achievements.savingsDeposit += Number(entry.savingsAccountDeposit || 0);
            achievements.praDeposit += Number(entry.praAccountDeposit || 0);
            achievements.currentDeposit += Number(entry.currentAccountDeposit || 0);
            achievements.sndDeposit += Number(entry.sndAccountDeposit || 0);
            achievements.fdrTermDeposit += Number(entry.fdrTermDeposit || 0);
            achievements.dpsDeposit += Number(entry.dpsDeposit || 0);
            achievements.totalDeposit += Number(entry.todayDeposit || 0);
            achievements.loans += Number(entry.loans || 0);
            achievements.qrOnboarding += entry.qrOnboarding || 0;
            achievements.apps += entry.apps || 0;
            achievements.cardActivations += entry.cardActivations || 0;
          });
          const percentages = {
            savingsAccountPercentage: target.savingsAccountTarget
              ? Math.round((achievements.savingsAccountOpened / target.savingsAccountTarget) * 100)
              : 0,
            praAccountPercentage: target.praAccountTarget
              ? Math.round((achievements.praAccountOpened / target.praAccountTarget) * 100)
              : 0,
            currentAccountPercentage: target.currentAccountTarget
              ? Math.round((achievements.currentAccountOpened / target.currentAccountTarget) * 100)
              : 0,
            sndAccountPercentage: target.sndAccountTarget
              ? Math.round((achievements.sndAccountOpened / target.sndAccountTarget) * 100)
              : 0,
            fdrTermAccountPercentage: target.fdrTermAccountTarget
              ? Math.round((achievements.fdrTermAccountOpened / target.fdrTermAccountTarget) * 100)
              : 0,
            dpsAccountPercentage: target.dpsAccountTarget
              ? Math.round((achievements.dpsAccountOpened / target.dpsAccountTarget) * 100)
              : 0,
            depositsPercentage: target.depositsTarget
              ? Math.round((achievements.totalDeposit / target.depositsTarget) * 100)
              : 0,
            loansPercentage: target.loansTarget ? Math.round((achievements.loans / target.loansTarget) * 100) : 0,
            qrOnboardingPercentage: target.qrOnboardingTarget
              ? Math.round((achievements.qrOnboarding / target.qrOnboardingTarget) * 100)
              : 0,
            appsPercentage: target.appsTarget ? Math.round((achievements.apps / target.appsTarget) * 100) : 0,
            cardActivationsPercentage: target.cardActivationsTarget
              ? Math.round((achievements.cardActivations / target.cardActivationsTarget) * 100)
              : 0,
          };
          const validPercentages = Object.values(percentages).filter((p) => p > 0);
          const overallPercentage =
            validPercentages.length > 0
              ? Math.round(validPercentages.reduce((sum, p) => sum + p, 0) / validPercentages.length)
              : 0;

          teamPerformance.push({
            userId: target._id,
            userEmail: target.userEmail,
            userName: target.userName,
            userRole: target.userRole,
            target,
            achievements,
            percentages,
            overallPercentage,
            salesCount: salesEntries.length,
          });
        }
        teamPerformance.sort((a, b) => b.overallPercentage - a.overallPercentage);
        res.send(teamPerformance);
      } catch (error) {
        console.error('Error fetching team performance:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/performance', async (req, res) => {
      try {
        const { userEmail, month, year } = req.query;

        if (!userEmail || !month || !year) {
          return res.status(400).send({ message: 'User email, month, and year are required' });
        }
        const target = await TargetsCollection.findOne({
          userEmail,
          month: Number.parseInt(month),
          year: Number.parseInt(year),
        });

        if (!target) {
          return res.status(404).send({ message: 'No target found for this month' });
        }
        const startDate = new Date(Number.parseInt(year), Number.parseInt(month) - 1, 1).toISOString().split('T')[0];
        const endDate = new Date(Number.parseInt(year), Number.parseInt(month), 0).toISOString().split('T')[0];
        const salesEntries = await SalesCollection.find({
          userEmail,
          date: { $gte: startDate, $lte: endDate },
        }).toArray();
        const achievements = {
          savingsAccountOpened: 0,
          praAccountOpened: 0,
          currentAccountOpened: 0,
          sndAccountOpened: 0,
          fdrTermAccountOpened: 0,
          dpsAccountOpened: 0,
          savingsDeposit: 0,
          praDeposit: 0,
          currentDeposit: 0,
          sndDeposit: 0,
          fdrTermDeposit: 0,
          dpsDeposit: 0,
          totalDeposit: 0,
          loans: 0,
          qrOnboarding: 0,
          apps: 0,
          cardActivations: 0,
        };

        salesEntries.forEach((entry) => {
          achievements.savingsAccountOpened += entry.savingsAccountOpened || 0;
          achievements.praAccountOpened += entry.praAccountOpened || 0;
          achievements.currentAccountOpened += entry.currentAccountOpened || 0;
          achievements.sndAccountOpened += entry.sndAccountOpened || 0;
          achievements.fdrTermAccountOpened += entry.fdrTermAccountOpened || 0;
          achievements.dpsAccountOpened += entry.dpsAccountOpened || 0;
          achievements.savingsDeposit += Number(entry.savingsAccountDeposit || 0);
          achievements.praDeposit += Number(entry.praAccountDeposit || 0);
          achievements.currentDeposit += Number(entry.currentAccountDeposit || 0);
          achievements.sndDeposit += Number(entry.sndAccountDeposit || 0);
          achievements.fdrTermDeposit += Number(entry.fdrTermDeposit || 0);
          achievements.dpsDeposit += Number(entry.dpsDeposit || 0);
          achievements.totalDeposit += Number(entry.todayDeposit || 0);
          achievements.loans += Number(entry.loans || 0);
          achievements.qrOnboarding += entry.qrOnboarding || 0;
          achievements.apps += entry.apps || 0;
          achievements.cardActivations += entry.cardActivations || 0;
        });
        const percentages = {
          savingsAccountPercentage: target.savingsAccountTarget
            ? Math.round((achievements.savingsAccountOpened / target.savingsAccountTarget) * 100)
            : 0,
          praAccountPercentage: target.praAccountTarget
            ? Math.round((achievements.praAccountOpened / target.praAccountTarget) * 100)
            : 0,
          currentAccountPercentage: target.currentAccountTarget
            ? Math.round((achievements.currentAccountOpened / target.currentAccountTarget) * 100)
            : 0,
          sndAccountPercentage: target.sndAccountTarget
            ? Math.round((achievements.sndAccountOpened / target.sndAccountTarget) * 100)
            : 0,
          fdrTermAccountPercentage: target.fdrTermAccountTarget
            ? Math.round((achievements.fdrTermAccountOpened / target.fdrTermAccountTarget) * 100)
            : 0,
          dpsAccountPercentage: target.dpsAccountTarget
            ? Math.round((achievements.dpsAccountOpened / target.dpsAccountTarget) * 100)
            : 0,
          depositsPercentage: target.depositsTarget
            ? Math.round((achievements.totalDeposit / target.depositsTarget) * 100)
            : 0,
          loansPercentage: target.loansTarget ? Math.round((achievements.loans / target.loansTarget) * 100) : 0,
          qrOnboardingPercentage: target.qrOnboardingTarget
            ? Math.round((achievements.qrOnboarding / target.qrOnboardingTarget) * 100)
            : 0,
          appsPercentage: target.appsTarget ? Math.round((achievements.apps / target.appsTarget) * 100) : 0,
          cardActivationsPercentage: target.cardActivationsTarget
            ? Math.round((achievements.cardActivations / target.cardActivationsTarget) * 100)
            : 0,
        };
        const validPercentages = Object.values(percentages).filter((p) => p > 0);
        const overallPercentage =
          validPercentages.length > 0
            ? Math.round(validPercentages.reduce((sum, p) => sum + p, 0) / validPercentages.length)
            : 0;

        res.send({
          target,
          achievements,
          percentages,
          overallPercentage,
          salesCount: salesEntries.length,
        });
      } catch (error) {
        console.error('Error fetching performance data:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.post('/batch-update-team-structure', async (req, res) => {
      try {
        const { userIds, managerEmail, managerName, managerRole } = req.body;

        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
          return res.status(400).send({ message: 'User IDs array is required and must not be empty' });
        }

        if (!managerEmail && managerEmail !== '') {
          return res.status(400).send({ message: 'Manager email is required (can be empty string for no manager)' });
        }

        const UsersCollection = client.db('Office').collection('User');
        const TeamStructureCollection = client.db('Office').collection('TeamStructure');
        const objectIds = userIds.map((id) => {
          try {
            return new ObjectId(id);
          } catch (e) {
            return id;
          }
        });

        const usersToUpdate = await UsersCollection.find({
          _id: { $in: objectIds },
        }).toArray();

        if (usersToUpdate.length === 0) {
          return res.status(404).send({ message: 'No valid users found with the provided IDs' });
        }
        const results = { updated: 0, created: 0, errors: [] };

        for (const user of usersToUpdate) {
          try {
            const existingMember = await TeamStructureCollection.findOne({ userEmail: user.emailAddress });
            if (existingMember) {
              await TeamStructureCollection.updateOne(
                { userEmail: user.emailAddress },
                {
                  $set: {
                    managerEmail,
                    managerName,
                    managerRole,
                    updatedAt: new Date().toISOString(),
                  },
                }
              );
              results.updated++;
            } else {
              await TeamStructureCollection.insertOne({
                userEmail: user.emailAddress,
                userName: user.fullName,
                userRole: user.userRole,
                managerEmail,
                managerName,
                managerRole,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
              results.created++;
            }
          } catch (error) {
            results.errors.push({
              userEmail: user.emailAddress,
              error: error.message,
            });
          }
        }

        res.send({
          message: `Batch update completed. Updated: ${results.updated}, Created: ${results.created}, Errors: ${results.errors.length}`,
          results,
        });
      } catch (error) {
        console.error('Error in batch update team structure:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
      }
    });
    app.get('/tasks', async (req, res) => {
      try {
        const { assigneeId, assignerId, status } = req.query;
        let query = {};
        if (assigneeId && assignerId) {
          query = {
            $or: [{ assigneeId: assigneeId }, { assignerId: assignerId }],
          };
        } else if (assigneeId) {
          query.assigneeId = assigneeId;
        } else if (assignerId) {
          query.assignerId = assignerId;
        }
        if (status) {
          query.status = status;
        }
        const result = await TasksCollection.find(query).sort({ status: 1, dueDate: 1 }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.post('/tasks', async (req, res) => {
      try {
        const {
          title,
          description,
          assigneeId,
          assignee,
          assigneeRole,
          assignerId,
          assigner,
          assignerRole,
          dueDate,
          priority,
        } = req.body;
        if (!title || !assigneeId || !assignerId || !dueDate) {
          return res.status(400).send({ message: 'Required fields missing' });
        }
        const task = {
          title,
          description: description || '',
          assigneeId,
          assignee,
          assigneeRole,
          assignerId,
          assigner,
          assignerRole,
          dueDate,
          priority: priority || 'medium',
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = await TasksCollection.insertOne(task);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.put('/tasks/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { title, description, dueDate, priority, status } = req.body;

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            title: title,
            description: description || '',
            dueDate: dueDate,
            priority: priority || 'medium',
            status: status || 'pending',
            updatedAt: new Date().toISOString(),
          },
        };

        const result = await TasksCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.patch('/tasks/:id/status', async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body;

        if (!status) {
          return res.status(400).send({ message: 'Status is required' });
        }

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status,
            updatedAt: new Date().toISOString(),
          },
        };

        const result = await TasksCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    app.delete('/tasks/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await TasksCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: error.message });
      }
    });
    cron.schedule('0 0 * * *', async () => {
      console.log('Running task cleanup job');
      try {
        const result = await TasksCollection.deleteMany({ status: 'completed' });
        console.log(`Deleted ${result.deletedCount} completed tasks`);
      } catch (error) {
        console.error('Error in task cleanup process:', error);
      }
    });
    app.get('/team-structure', async (req, res) => {
      try {
        const TeamStructureCollection = client.db('Office').collection('TeamStructure');
        const teamStructure = await TeamStructureCollection.find({}).toArray();
        res.send(teamStructure);
      } catch (error) {
        console.error('Error fetching team structure:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
      }
    });
    app.delete('/team-structure-rsm/:userEmail', async (req, res) => {
      try {
        const { userEmail } = req.params;
        if (!userEmail) {
          return res.status(400).send({ message: 'User email is required' });
        }
        const TeamStructureCollection = client.db('Office').collection('TeamStructure');
        const user = await TeamStructureCollection.findOne({ userEmail });

        if (!user) {
          return res.status(404).send({ message: 'User not found in team structure' });
        }
        const result = await TeamStructureCollection.deleteOne({ userEmail });
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: 'Failed to remove user from team structure' });
        }
        res.send({ message: 'User removed from team structure', result });
      } catch (error) {
        console.error('Error removing RSM from team structure:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
      }
    });
    app.post('/update-team-structure', async (req, res) => {
      try {
        const { userId, userEmail, userName, userRole, managerEmail, managerName, managerRole } = req.body;
        if (!userEmail || !userName || !userRole) {
          return res.status(400).send({ message: 'Required fields missing' });
        }
        const TeamStructureCollection = client.db('Office').collection('TeamStructure');
        const existingMember = await TeamStructureCollection.findOne({ userEmail });
        if (existingMember) {
          const result = await TeamStructureCollection.updateOne(
            { userEmail },
            {
              $set: {
                managerEmail,
                managerName,
                managerRole,
                updatedAt: new Date().toISOString(),
              },
            }
          );
          return res.send(result);
        }
        const result = await TeamStructureCollection.insertOne({
          userEmail,
          userName,
          userRole,
          managerEmail,
          managerName,
          managerRole,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        res.send(result);
      } catch (error) {
        console.error('Error updating team structure:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
      }
    });
    app.delete('/team-structure/:userEmail', async (req, res) => {
      try {
        const { userEmail } = req.params;
        if (!userEmail) {
          return res.status(400).send({ message: 'User email is required' });
        }
        const TeamStructureCollection = client.db('Office').collection('TeamStructure');
        const result = await TeamStructureCollection.deleteOne({ userEmail });
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: 'User not found in team structure' });
        }
        res.send({ message: 'User removed from team structure', result });
      } catch (error) {
        console.error('Error removing user from team structure:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
      }
    });
    app.get('/team-performance', async (req, res) => {
      try {
        const { managerEmail, month, year } = req.query;
        if (!managerEmail || !month || !year) {
          return res.status(400).send({ message: 'Manager email, month, and year are required' });
        }
        const TeamStructureCollection = client.db('Office').collection('TeamStructure');
        const TargetsCollection = client.db('Office').collection('Targets');
        const SalesCollection = client.db('Office').collection('Sales');
        const teamMembers = await TeamStructureCollection.find({
          managerEmail: managerEmail,
        }).toArray();
        const asmEmails = teamMembers
          .filter((member) => member.userRole.toLowerCase() === 'asm')
          .map((asm) => asm.userEmail);
        let allTeamMembers = [...teamMembers];
        if (asmEmails.length > 0) {
          const usmUnderAsms = await TeamStructureCollection.find({
            managerEmail: { $in: asmEmails },
          }).toArray();
          allTeamMembers = [...allTeamMembers, ...usmUnderAsms];
        }
        const teamPerformance = await Promise.all(
          allTeamMembers.map(async (member) => {
            const target = await TargetsCollection.findOne({
              userEmail: member.userEmail,
              month: Number.parseInt(month),
              year: Number.parseInt(year),
            });

            if (!target) {
              return null;
            }
            const startDate = new Date(Number.parseInt(year), Number.parseInt(month) - 1, 1);
            const endDate = new Date(Number.parseInt(year), Number.parseInt(month), 0);
            const sales = await SalesCollection.find({
              userEmail: member.userEmail,
              createdAt: {
                $gte: startDate,
                $lte: endDate,
              },
            }).toArray();
            const achievements = {
              savingsAccountOpened: sales.filter((s) => s.accountType === 'savings').length,
              praAccountOpened: sales.filter((s) => s.accountType === 'pra').length,
              currentAccountOpened: sales.filter((s) => s.accountType === 'current').length,
              sndAccountOpened: sales.filter((s) => s.accountType === 'snd').length,
              fdrTermAccountOpened: sales.filter((s) => s.accountType === 'fdr').length,
              dpsAccountOpened: sales.filter((s) => s.accountType === 'dps').length,
              totalDeposit: sales.reduce((sum, sale) => sum + (sale.depositAmount || 0), 0),
              loans: sales.reduce((sum, sale) => sum + (sale.loanAmount || 0), 0),
              qrOnboarding: sales.filter((s) => s.qrOnboarded).length,
              apps: sales.filter((s) => s.appInstalled).length,
              cardActivations: sales.filter((s) => s.cardActivated).length,
            };
            const percentages = {
              savingsAccountPercentage: calculatePercentage(
                achievements.savingsAccountOpened,
                target.savingsAccountTarget
              ),
              praAccountPercentage: calculatePercentage(achievements.praAccountOpened, target.praAccountTarget),
              currentAccountPercentage: calculatePercentage(
                achievements.currentAccountOpened,
                target.currentAccountTarget
              ),
              sndAccountPercentage: calculatePercentage(achievements.sndAccountOpened, target.sndAccountTarget),
              fdrTermAccountPercentage: calculatePercentage(
                achievements.fdrTermAccountOpened,
                target.fdrTermAccountTarget
              ),
              dpsAccountPercentage: calculatePercentage(achievements.dpsAccountOpened, target.dpsAccountTarget),
              depositsPercentage: calculatePercentage(achievements.totalDeposit, target.depositsTarget),
              loansPercentage: calculatePercentage(achievements.loans, target.loansTarget),
              qrOnboardingPercentage: calculatePercentage(achievements.qrOnboarding, target.qrOnboardingTarget),
              appsPercentage: calculatePercentage(achievements.apps, target.appsTarget),
              cardActivationsPercentage: calculatePercentage(
                achievements.cardActivations,
                target.cardActivationsTarget
              ),
            };
            const overallPercentage = Math.round(
              Object.values(percentages).reduce((sum, percentage) => sum + percentage, 0) /
                Object.values(percentages).length
            );

            return {
              userId: member._id,
              userEmail: member.userEmail,
              userName: member.userName,
              userRole: member.userRole,
              target,
              achievements,
              percentages,
              overallPercentage,
              salesCount: sales.length,
            };
          })
        );
        const validPerformance = teamPerformance.filter((item) => item !== null);
        res.send(validPerformance);
      } catch (error) {
        console.error('Error fetching team performance:', error);
        res.status(500).send({ message: 'Internal server error', error: error.message });
      }
    });
    app.post('/add-leave', async (req, res) => {
      try {
        const data = req.body;
        const result = await LeaveCollection.insertOne(data);
        res.send(result);
      } catch (error) {
        res.send(error.message);
      }
    });
    app.get('/leaves-email', async (req, res) => {
      try {
        const email = req.query.email;
        const query = { email: email };
        const result = await LeaveCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.send(error);
      }
    });
    app.get('/leaves', async (req, res) => {
      try {
        const result = await LeaveCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.send(error);
      }
    });
    app.get('/pending-leaves', async (req, res) => {
      try {
        const email = req.query.email;
        const query = { email: email, status: 'Pending' };
        const result = await LeaveCollection.find(query).toArray();
        res.send(result);
      } catch (error) {
        res.send(error);
      }
    });
    app.patch('/approve-leaves/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updatedData = {
          $set: {
            status: 'Approved',
          },
        };
        const result = await LeaveCollection.updateOne(query, updatedData);
        res.send(result);
      } catch (error) {
        res.send(error);
      }
    });
    app.patch('/reject-leaves/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const updatedData = {
          $set: {
            status: 'Rejected',
          },
        };
        const result = await LeaveCollection.updateOne(query, updatedData);
        res.send(result);
      } catch (error) {
        res.send(error);
      }
    });
    function calculatePercentage(achieved, target) {
      if (!target) return 0;
      return Math.round((achieved / target) * 100);
    }
    app.post('/job-posts', async (req, res) => {
      try {
        const {
          title,
          description,
          customFields,
          deadline,
          postedBy,
          postedByEmail,
          postedByRole,
          status = 'active',
        } = req.body;
        if (!title || !description || !deadline || !postedByEmail) {
          return res.status(400).send({ message: 'Required fields missing' });
        }
        const jobPost = {
          title,
          description,
          customFields: customFields || [],
          deadline: new Date(deadline),
          postedBy,
          postedByEmail,
          postedByRole,
          status,
          createdAt: new Date(),
          updatedAt: new Date(),
          applications: 0,
        };

        const result = await JobPostCollection.insertOne(jobPost);
        res.status(201).send(result);
      } catch (error) {
        console.error('Error creating job post:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/job-posts', async (req, res) => {
      try {
        const { status, postedByEmail } = req.query;
        const query = {};
        if (status && status !== 'all') {
          query.status = status;
        }
        if (postedByEmail) {
          query.postedByEmail = postedByEmail;
        }
        const result = await JobPostCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.send(result);
      } catch (error) {
        console.error('Error fetching job posts:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/job-posts/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const jobPost = await JobPostCollection.findOne(query);
        if (!jobPost) {
          return res.status(404).send({ message: 'Job post not found' });
        }
        res.send(jobPost);
      } catch (error) {
        console.error('Error fetching job post:', error);
        res.status(500).send({ message: error.message });
      }
    });

    app.put('/job-posts/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { title, description, customFields, deadline, status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            title,
            description,
            customFields,
            deadline: new Date(deadline),
            status,
            updatedAt: new Date(),
          },
        };
        const result = await JobPostCollection.updateOne(filter, updateDoc);
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Job post not found' });
        }
        res.send(result);
      } catch (error) {
        console.error('Error updating job post:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.delete('/job-posts/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const applications = await JobApplicationCollection.find({ jobPostId: id }).limit(1).toArray();
        if (applications.length > 0) {
          return res.status(400).send({
            message: 'Cannot delete job post with existing applications. Archive it instead.',
          });
        }
        const result = await JobPostCollection.deleteOne(query);
        if (result.deletedCount === 0) {
          return res.status(404).send({ message: 'Job post not found' });
        }
        res.send(result);
      } catch (error) {
        console.error('Error deleting job post:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.patch('/job-posts/:id/archive', async (req, res) => {
      try {
        const { id } = req.params;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status: 'archived',
            updatedAt: new Date(),
          },
        };
        const result = await JobPostCollection.updateOne(filter, updateDoc);
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Job post not found' });
        }
        res.send(result);
      } catch (error) {
        console.error('Error archiving job post:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.post('/job-applications', async (req, res) => {
      try {
        const {
          jobPostId,
          personalInfo,
          educationalBackground,
          employmentHistory,
          skillsAndCertifications,
          references,
          additionalInfo,
          contactNumber,
        } = req.body;
        if (!jobPostId || !personalInfo) {
          return res.status(400).send({ message: 'Required fields missing' });
        }
        const jobPost = await JobPostCollection.findOne({ _id: new ObjectId(jobPostId) });
        if (!jobPost) {
          return res.status(404).send({ message: 'Job post not found' });
        }
        if (jobPost.status !== 'active') {
          return res.status(400).send({ message: 'This job post is no longer accepting applications' });
        }
        if (new Date(jobPost.deadline) < new Date()) {
          return res.status(400).send({ message: 'The deadline for this job post has passed' });
        }
        const application = {
          jobPostId: jobPost._id.toString(),
          jobTitle: jobPost.title,
          status: 'pending',
          personalInfo,
          educationalBackground: educationalBackground || [],
          employmentHistory: employmentHistory || [],
          skillsAndCertifications: skillsAndCertifications || {},
          references: references || [],
          additionalInfo: additionalInfo || {},
          appliedAt: new Date(),
          updatedAt: new Date(),
        };
        const result = await JobApplicationCollection.insertOne(application);
        await JobPostCollection.updateOne({ _id: jobPost._id }, { $inc: { applications: 1 } });
        res.status(201).send(result);
      } catch (error) {
        console.error('Error submitting job application:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/job-applications', async (req, res) => {
      try {
        const { jobPostId, status, sort, sortDirection = 'asc' } = req.query;
        if (!jobPostId) {
          return res.status(400).send({ message: 'Job post ID is required' });
        }
        const query = { jobPostId };
        if (status) {
          query.status = status;
        }
        const sortOptions = {};
        if (sort) {
          switch (sort) {
            case 'age':
              sortOptions['personalInfo.dateOfBirth'] = sortDirection === 'asc' ? 1 : -1;
              break;
            case 'prevCompany':
              sortOptions['employmentHistory.0.companyName'] = sortDirection === 'asc' ? 1 : -1;
              break;
            case 'gender':
              sortOptions['personalInfo.gender'] = sortDirection === 'asc' ? 1 : -1;
              break;
            case 'education':
              sortOptions['educationalBackground.0.subject'] = sortDirection === 'asc' ? 1 : -1;
              break;
            case 'expectedSalary':
              sortOptions['additionalInfo.expectedSalary'] = sortDirection === 'asc' ? 1 : -1;
              break;
            default:
              sortOptions.appliedAt = -1;
          }
        } else {
          sortOptions.appliedAt = -1;
        }
        const applications = await JobApplicationCollection.find(query).sort(sortOptions).toArray();
        res.send(applications);
      } catch (error) {
        console.error('Error fetching job applications:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.get('/job-applications/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const query = { _id: new ObjectId(id) };
        const application = await JobApplicationCollection.findOne(query);
        if (!application) {
          return res.status(404).send({ message: 'Application not found' });
        }
        res.send(application);
      } catch (error) {
        console.error('Error fetching job application:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.patch('/job-applications/:id/status', async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body;
        if (!status || !['pending', 'shortlisted', 'rejected', 'archived'].includes(status)) {
          return res.status(400).send({ message: 'Valid status is required' });
        }
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            status,
            updatedAt: new Date(),
          },
        };
        const result = await JobApplicationCollection.updateOne(filter, updateDoc);
        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Application not found' });
        }
        res.send(result);
      } catch (error) {
        console.error('Error updating application status:', error);
        res.status(500).send({ message: error.message });
      }
    });
    app.post('/job-applications/generate-report', async (req, res) => {
      try {
        const { jobPostId, filters, sortBy, sortDirection } = req.body;
        if (!jobPostId) {
          return res.status(400).send({ message: 'Job post ID is required' });
        }
        res.send({
          message: 'Report generation initiated',
          status: 'processing',
          reportUrl: `/reports/${jobPostId}_${Date.now()}.pdf`,
        });
      } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).send({ message: error.message });
      }
    });
    cron.schedule('0 0 * * *', async () => {
      console.log('Running job post deadline check');
      try {
        const now = new Date();
        const expiredPosts = await JobPostCollection.find({
          status: 'active',
          deadline: { $lt: now },
        }).toArray();
        console.log(`Found ${expiredPosts.length} expired job posts`);
        if (expiredPosts.length > 0) {
          const result = await JobPostCollection.updateMany(
            { _id: { $in: expiredPosts.map((post) => post._id) } },
            { $set: { status: 'closed', updatedAt: now } }
          );

          console.log(`Closed ${result.modifiedCount} expired job posts`);
        }
      } catch (error) {
        console.error('Error in job post deadline check:', error);
      }
    });
    console.log('Done Connect');
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', async (req, res) => {
  res.send('Office Management is cooking');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
