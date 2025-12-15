const express = require('express')
const cors = require('cors')
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const port = process.env.PORT || 3000

//middleware
app.use(express.json());
app.use(cors());

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
    const productsCollection = db.collection('products');

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

    app.post('/products', async (req, res) => {
      const product = req.body;
      const result = await productsCollection.insertOne(product);
      res.send(result);
    })

    const myOrdersCollection = db.collection('myOrders');

    app.get('/my-orders', async (req, res) => {

      const query = {};
      const {email} = req.query;

      if(email){
        query.email = email;
      }

      const options = {sort : {createdAt : -1 }};

      const cursor = myOrdersCollection.find(query, options);
      const result = await cursor.toArray();
      res.send(result)
    })

    app.get('/payment/:id', async(req, res)=>{
      const id = req.params.id;

      const query = { _id : new ObjectId(id)};
      const result = await myOrdersCollection.findOne(query);
      res.send(result)
    })

    app.post('/my-orders', async (req, res) => {
      const order = req.body;

      order.createdAt = new Date();
      const result = await myOrdersCollection.insertOne(order);
      res.send(result);
    })

    app.delete('/my-orders/:id', async(req,res)=>{
      const id = req.params.id ;
      const query = { _id : new ObjectId(id)}

      const result = await myOrdersCollection.deleteOne(query);
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