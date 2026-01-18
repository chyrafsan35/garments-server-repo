const express = require('express')
require('dotenv').config()
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const admin = require('firebase-admin')
const stripe = require('stripe')(process.env.STRIPE_SECURE)

const app = express()
const port = process.env.PORT || 3000

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
	'utf8',
)
const serviceAccount = JSON.parse(decoded)

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
})

//middleware
app.use(cors())
app.use(express.json())

const verifyFirebaseToken = async (req, res, next) => {
	// console.log('Headers in the middleware ', req.headers?.authorization)

	const token = req?.headers?.authorization
	if (!token) {
		return res.status(401).send({ message: 'Unauthorized access denied !' })
	}

	try {
		const idToken = token.split(' ')[1]
		const decoded = await admin.auth().verifyIdToken(idToken)
		// console.log('Decoded token : ', decoded)
		req.decoded_email = decoded.email
	} catch (err) {
		res.status(401).send({ message: 'Unauthorized access ' })
	}

	next()
}

function generateTrackingId() {
	const prefix = 'TRK'
	const timestamp = Date.now().toString(36).toUpperCase()
	const random = Math.random().toString(36).substring(2, 7).toUpperCase()
	return `${prefix}-${timestamp}-${random}`
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.o0d4b4z.mongodb.net/?appName=Cluster0`

const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	},
})

async function run() {
	try {
		const db = client.db('garments_products_db')
		const usersCollection = db.collection('users')
		const productsCollection = db.collection('products')
		const myOrdersCollection = db.collection('myOrders')
		const paymentCollection = db.collection('payments')

		const verifyManagerStatusRejectedOrApproved = (usersCollection) => {
			return async (req, res, next) => {
				const email = req.decoded_email;
				if (!email) return res.status(401).send({ message: 'Email not decoded' });

				try {
					const user = await usersCollection.findOne({ user_email: email });
					if (!user) return res.status(404).send({ message: 'User not found' });

					if (user.user_role === 'Manager' && user.status === 'Rejected') {
						return res.status(403).send({
							message: 'Rejected managers cannot add new products, approve or reject orders ',
						});
					}

					next();
				} catch (err) {
					console.error('Middleware error:', err);
					res.status(500).send({ message: 'Server error in middleware' });
				}
			};
		};


		const verifyAdmin = async (req, res, next) => {
			const email = req.decoded_email
			const query = { user_email: email }
			const user = await usersCollection.findOne(query)

			if (!user || user.user_role !== 'Admin') {
				return res.status(403).send({ message: 'forbidden' })
			}
			next()
		}

		app.get('/users/:email', async (req, res) => {
			const email = req.params.email
			const result = await usersCollection.findOne({ user_email: email })
			res.send(result)
		})

		app.get('/users', async (req, res) => {
			const { } = req.query

			const cursor = usersCollection.find()
			const result = await cursor.toArray()
			res.send(result)
		})

		app.get('/users/:email/user_role', async (req, res) => {
			const email = req.params.email
			const query = { user_email: email }
			const user = await usersCollection.findOne(query)
			res.send({ user_role: user?.user_role || 'user' })
		})

		app.post('/users', async (req, res) => {
			const user = req.body
			user.role = 'user'
			user.status = 'Pending'
			user.createdAt = new Date()
			const email = user.user_email

			const existingUser = await usersCollection.findOne({ email })
			if (existingUser) {
				return res.send({ message: 'User already exists ! ' })
			}

			const result = await usersCollection.insertOne(user)
			res.send(result)
		})

		app.patch(
			'/users/:id',
			verifyFirebaseToken,
			verifyAdmin,
			async (req, res) => {
				const status = req.body.status
				const reason = req.body.rejectionReason
				const feedback = req.body.adminFeedback
				const id = req.params.id
				const query = { _id: new ObjectId(id) }
				const updatedDoc = {
					$set: {
						status: status,
						rejectionReason: reason,
						adminFeedback: feedback,
					},
				}
				const result = await usersCollection.updateOne(query, updatedDoc)
				res.send(result)
			},
		)

		app.get('/products', async (req, res) => {
			const { limit = 0, skip = 0, sort = "price", order = "desc", search = "", category = "" } = req.query;

			const sortOption = {};
			sortOption[sort || "price"] = order === "asc" ? 1 : -1;

			let query = {};
			if (search) {
				query.title = { $regex: search, $options: 'i' }
			}

			if (category) {
				query.category = category; 
			}

			const products = await productsCollection
				.find(query)
				.sort(sortOption)
				.limit(Number(limit))
				.skip(Number(skip))
				.toArray();

			const count = await productsCollection.countDocuments(query);
			res.send({ products, total: count })
		})

		app.get('/home/products', async (req, res) => {
			const { limit = 0 } = req.query

			const cursor = productsCollection
				.find({ showOnHome: true })
				.sort({ _id: -1 })
				.limit(Number(limit))
			const result = await cursor.toArray()
			res.send(result)
		})

		app.get('/admin/products', verifyFirebaseToken, verifyAdmin, async (req, res) => {
			const result = await productsCollection
				.find()
				.sort({ _id: -1 })
				.toArray()
			res.send(result)
		}
		)


		app.get('/products/:id', async (req, res) => {
			const { id } = req.params

			const result = await productsCollection.findOne({ _id: new ObjectId(id) })
			res.send(result)
		})

		app.get('/products/by-email/:email', async (req, res) => {
			const email = req.params.email

			const result = await productsCollection
				.find({ createdBy: email })
				.toArray()
			res.send(result)
		})

		app.patch('/products/:id', async (req, res) => {
			const id = req.params.id
			const query = { _id: new ObjectId(id) }
			const updateFields = req.body
			const updateDoc = {
				$set: updateFields,
			}
			const result = await productsCollection.updateOne(query, updateDoc)
			res.send(result)
		})

		app.delete('/products/:id', async (req, res) => {
			const id = req.params.id
			const query = { _id: new ObjectId(id) }

			const result = await productsCollection.deleteOne(query)
			res.send(result)
		})

		app.post('/products', verifyFirebaseToken, verifyManagerStatusRejectedOrApproved(usersCollection), async (req, res) => {
			const product = req.body
			const result = await productsCollection.insertOne(product)
			res.send(result)
		})

		app.get('/my-orders', async (req, res) => {
			const query = {}
			const { email } = req.query

			if (email) {
				query.email = email
			}

			const options = { sort: { createdAt: -1 } }

			const cursor = myOrdersCollection.find(query, options)
			const result = await cursor.toArray()
			res.send(result)
		})

		app.get('/my-orders/:email/status', async (req, res) => {
			const email = req.params.email

			const result = await myOrdersCollection
				.find({ createdBy: email, orderStatus: "Pending" })
				.toArray()
			res.send(result)
		})

		app.patch('/my-orders/:id', async (req, res) => {
			const id = req.params.id
			const query = { _id: new ObjectId(id) }
			const updateFields = req.body
			const updateDoc = {
				$set: updateFields,
			}
			const result = await myOrdersCollection.updateOne(query, updateDoc)
			res.send(result)
		})

		app.patch('/my-orders/:id/approve', verifyFirebaseToken, verifyManagerStatusRejectedOrApproved(usersCollection), async (req, res) => {
			const id = req.params.id
			const query = { _id: new ObjectId(id) }
			const updateDoc = {
				$set: {
					orderStatus: 'Approved',
					approvedAt: new Date(),
				},
			}
			const result = await myOrdersCollection.updateOne(query, updateDoc)
			res.send(result)
		})

		app.get('/my-orders/approved/:email', async (req, res) => {
			const email = req.params.email

			try {
				const result = await myOrdersCollection
					.find({ createdBy: email, orderStatus: 'Approved' })
					.toArray()
				res.send(result)
			} catch (err) {
				console.error(err)
				res.status(500).send({ message: 'Failed to fetch approved orders' })
			}
		})

		app.patch('/my-orders/:id/reject', verifyFirebaseToken, verifyManagerStatusRejectedOrApproved(usersCollection), async (req, res) => {
			const id = req.params.id
			const query = { _id: new ObjectId(id) }
			const updateDoc = { $set: { orderStatus: 'Rejected' } }
			const result = await myOrdersCollection.updateOne(query, updateDoc)
			res.send(result)
		})

		app.get('/payment/:id', async (req, res) => {
			const id = req.params.id

			const query = { _id: new ObjectId(id) }
			const result = await myOrdersCollection.findOne(query)
			res.send(result)
		})

		app.post('/my-orders', async (req, res) => {
			const order = req.body

			order.createdAt = new Date()
			const result = await myOrdersCollection.insertOne(order)
			res.send(result)
		})

		app.delete('/my-orders/:id', async (req, res) => {
			const id = req.params.id
			const query = { _id: new ObjectId(id) }

			const result = await myOrdersCollection.deleteOne(query)
			res.send(result)
		})

		app.post('/create-checkout-session', async (req, res) => {
			const { cost, productId, productName, email } = req.body

			const amount = parseInt(cost) * 100

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
			})

			res.send({ url: session.url })
		})

		app.patch('/payment-success', async (req, res) => {
			const sessionId = req.query.session_id
			const session = await stripe.checkout.sessions.retrieve(sessionId)

			const transactionId = session.payment_intent
			const trackingID = generateTrackingId()

			const query = {
				transactionId: transactionId,
			}

			const paymentExist = await paymentCollection.findOne(query)

			if (paymentExist) {
				return res.send({
					message: 'Already exists',
					transactionId,
					trackingId: trackingID,
				})
			}

			if (session.payment_status === 'paid') {
				const id = session.metadata.productID
				await myOrdersCollection.updateOne(
					{ _id: new ObjectId(id) },
					{ $set: { paymentStatus: 'paid', trackingId: trackingID } },
				)

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
					await paymentCollection.insertOne(payment)
					res.send({
						success: true,
						trackingId: trackingID,
						transactionID: transactionId,
					})
				} catch (err) {
					// console.error('Payment insert failed:', err)
					res.status(500).send({ error: 'Payment record failed' })
				}
			}
		})

		app.get('/payments', verifyFirebaseToken, async (req, res) => {
			const email = req.query.email
			const query = {}

			// console.log('Headers', req.headers)

			if (email) {
				query.customerEmail = email

				if (email !== req.decoded_email) {
					return res.status(403).send({ message: ' Forbidden access ' })
				}
			}
			const cursor = paymentCollection.find(query)
			const result = await cursor.toArray()
			res.send(result)
		})

		console.log(
			'Pinged your deployment. You successfully connected to MongoDB!',
		)
	} finally {
	}
}
run().catch(console.dir)

app.get('/', (req, res) => {
	res.send('Server is running on Vercel 🚀')
})

app.listen(port, () => {
	console.log('Server running on port :', port)
})
