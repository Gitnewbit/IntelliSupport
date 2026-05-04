const functions = require("firebase-functions");
const nodemailer = require("nodemailer");

// Configure your email (use Gmail or business email)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "your-email@gmail.com",
    pass: "your-app-password"
  }
});

exports.sendTicketEmail = functions.firestore
  .document("tickets/{ticketId}")
  .onCreate(async (snap, context) => {

    const ticket = snap.data();

    const mailOptions = {
      from: "IntelliSupport <your-email@gmail.com>",
      to: ticket.technicianEmail,
      subject: `New Ticket Assigned: ${ticket.title}`,
      html: `
        <h2>New Support Ticket</h2>
        <p><b>Title:</b> ${ticket.title}</p>
        <p><b>Description:</b> ${ticket.description}</p>
        <p><b>Priority:</b> ${ticket.priority}</p>
      `
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log("Email sent");
    } catch (error) {
      console.error(error);
    }
  });