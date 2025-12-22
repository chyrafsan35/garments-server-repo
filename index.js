const express = require('express')
const cors = require('cors')
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECURE);

const port = process.env.PORT || 3000


function generateTrackingId() {
  const prefix = 'TRK';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();

  return `${prefix}-${timestamp}-${random}`;
}

module.exports = generateTrackingId;

const admin = require("firebase-admin");

const serviceAccount = require("./garments-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

//middleware
app.use(express.json());
app.use(cors());

const verifyFirebaseToken = async (req, res, next) => {
  console.log('Headers in the middleware ', req.headers?.authorization);

  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: 'Unauthorized access denied !' })
  }

  try {
    const idToken = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log('Decoded token : ', decoded)
    req.decoded_email = decoded.email;

  } catch (err) {
    res.status(401).send({ message: 'Unauthorized access ' })
  }

  next();
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.o0d4b4z.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const db = client.db('garments_products_db');
    const usersCollection = db.collection('users');
    const productsCollection = db.collection('products');
    const myOrdersCollection = db.collection('myOrders');
    const paymentCollection = db.collection('payments');

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { user_email: email };
      const user = await usersCollection.findOne(query);

      if (!user || user.user_role !== 'Admin') {
        return res.status(403).send({ message: 'forbidden' })
      }
      next();
    }

    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ user_email: email });
      res.send(result);
    });

    app.get('/users', async (req, res) => {
      const { } = req.query;

      const cursor = usersCollection.find();
      const result = await cursor.toArray();
      res.send(result)
    })

    app.get('/users/:email/user_role', async (req, res) => {
      const email = req.params.email;
      const query = { user_email: email };
      const user = await usersCollection.findOne(query);
      res.send({ user_role: user?.user_role || 'user' })
    })

    app.post('/users', async (req, res) => {
      const user = req.body;
      user.role = 'user';
      user.status = 'Pending';
      user.createdAt = new Date();
      const email = user.user_email;

      const existingUser = await usersCollection.findOne({ email })
      if (existingUser) {
        return res.send({ message: 'User already exists ! ' })
      }

      const result = await usersCollection.insertOne(user);
      res.send(result)
    })

    app.patch('/users/:id', verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const status = req.body.status;
      const reason = req.body.rejectionReason;
      const feedback = req.body.adminFeedback;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: status,
          rejectionReason: reason,
          adminFeedback: feedback
        }
      }
      const result = await usersCollection.updateOne(query, updatedDoc)
      res.send(result)
    })

    app.get('/products', async (req, res) => {
      const { limit = 0 } = req.query;

      const cursor = productsCollection.find().limit(Number(limit));
      const result = await cursor.toArray();
      res.send(result)
    })

    app.get('/products/:id', async (req, res) => {
      const { id } = req.params;

      const result = await productsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result)
    })

    app.patch('/products/:id', async (req, res) => {

      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updateFields = req.body;
      const updateDoc = {
        $set: updateFields
      }
      const result = await productsCollection.updateOne(query, updateDoc)
      res.send(result)
    })

    app.delete('/products/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const result = await myOrdersCollection.deleteOne(query);
      res.send(result)
    })

    app.post('/products', async (req, res) => {
      const product = req.body;
      const result = await productsCollection.insertOne(product);
      res.send(result);
    })

    app.get('/my-orders', async (req, res) => {

      const query = {};
      const { email } = req.query;

      if (email) {
        query.email = email;
      }

      const options = { sort: { createdAt: -1 } };

      const cursor = myOrdersCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result)
    })

    app.get('/payment/:id', async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const result = await myOrdersCollection.findOne(query);
      res.send(result)
    })

    app.post('/my-orders', async (req, res) => {
      const order = req.body;

      order.createdAt = new Date();
      const result = await myOrdersCollection.insertOne(order);
      res.send(result);
    })

    app.delete('/my-orders/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }

      const result = await myOrdersCollection.deleteOne(query);
      res.send(result)
    })



    app.post('/create-checkout-session', async (req, res) => {
      const { cost, productId, productName, email } = req.body;

      const amount = parseInt(cost) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: amount,
              product_data: {
                name: productName,
              },
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        customer_email: email,
        metadata: {
          productID: productId,
          productTitle: productName,
        },
        success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
      });

      res.send({ url: session.url });
    });

    app.patch('/payment-success', async (req, res) => {
      const sessionId = req.query.session_id;
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const transactionId = session.payment_intent;
      const trackingID = generateTrackingId();

      const query = {
        transactionId: transactionId,
      }

      const paymentExist = await paymentCollection.findOne(query);

      if (paymentExist) {
        return res.send({ message: 'Already exists', transactionId, trackingId: trackingID })
      }

      if (session.payment_status === 'paid') {
        const id = session.metadata.productID;
        await myOrdersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { paymentStatus: 'paid', trackingId: trackingID } }
        );

        const payment = {
          amount: session.amount_total / 100,
          currency: session.currency,
          customerEmail: session.customer_email,
          productId: session.metadata.productID,
          productName: session.metadata.productTitle,
          transactionId: session.payment_intent,
          paymentStatus: session.payment_status,
          paidAt: new Date(),
          trackingId: trackingID,
        }

        try {
          await paymentCollection.insertOne(payment);
          res.send({ success: true, trackingId: trackingID, transactionID: transactionId });
        } catch (err) {
          console.error("Payment insert failed:", err);
          res.status(500).send({ error: "Payment record failed" });
        }
      }

    })

    app.get('/payments', verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      const query = {};

      console.log('Headers', req.headers)

      if (email) {
        query.customerEmail = email;

        if (email !== req.decoded_email) {
          return res.status(403).send({ message: ' Forbidden access ' })
        }
      }
      const cursor = paymentCollection.find(query);
      const result = await cursor.toArray();
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Yay No ones shifting')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})