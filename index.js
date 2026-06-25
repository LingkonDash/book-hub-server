const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");

const app = express();

dotenv.config();
const port = process.env.PORT || 5000;
const uri = process.env.MONGODB_URI

app.use(cors());
app.use(express.json());

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

// ─────────────────────────────────────────────
// MIDDLEWARE 1: verifyToken
// ─────────────────────────────────────────────
const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload; // saving the payload
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden", error, });
  }
};


// ─────────────────────────────────────────────
// MIDDLEWARE 2: verifyLibrarian
// Admin can also pass (admin has all librarian powers)
// ─────────────────────────────────────────────
const verifyLibrarian = (req, res, next) => {

  const role = req.user?.userRole;
  if (role !== 'librarian' && role !== 'admin') {
    return res.status(403).json({ message: 'Forbidden - Librarian access required' });
  }
  next();
};


async function run() {
  try {

    await client.connect();

    const db = client.db('book-hub');
    const bookCollection = db.collection('books');
    const transactionCollection = db.collection('transactions');
    const reviewsCollection = db.collection('reviews');
    const deliveryCollection = db.collection('deliveries');


    // server check
    app.get('/', (req, res) => {
      res.send('Book HUb server is running!')
    });


    // Books endpoint 1------------------------------------------
    // GET /books?page=1&limit=12&category=fiction&search=harry
    app.get('/books', async (req, res) => {

      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 12;
        const category = req.query.category || '';
        const search = req.query.search || '';
        const sort = req.query.sort || 'latest';
        const skip = (page - 1) * limit;

        const filter = { status: 'published' };

        if (category) {
          filter.category = category;
        }

        if (search) {
          filter.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
          ];
        }

        // ── Sort logic 
        let sortQuery = {};

        if (sort === 'latest') {
          sortQuery = { createdAt: -1 };           // newest first
        } else if (sort === 'price-low') {
          sortQuery = { deliveryFee: 1 };          // lowest fee first
        } else if (sort === 'price-high') {
          sortQuery = { deliveryFee: -1 };         // highest fee first
        } else if (sort === 'available') {
          filter.status = 'published';             // only show published books
          sortQuery = { createdAt: -1 };           // among those, newest first
        }

        const total = await bookCollection.countDocuments(filter);
        const books = await bookCollection
          .find(filter)
          .sort(sortQuery)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.json({
          books,
          total,
          page,
          totalPages: Math.ceil(total / limit),
        });
      } catch (e) {
        res.status(500).json({ message: 'Failed to fetch books', error: e.message });
      }
    });


    // ── Get single book detail ──
    // GET /books/:id
    app.get('/books/:id', async (req, res) => {
      try {
        const book = await bookCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!book) return res.status(404).json({ message: 'Book not found' });
        res.json(book);
      } catch (e) {
        res.status(500).json({ message: 'Failed to fetch book', error: e.message });
      }
    });

    // ── Update single book detail ──
    // PATCH /books/:id
    app.patch('/books/:id', verifyToken, verifyLibrarian, async (req, res) => {
      try {
        const { id } = req.params;
        const updatedBook = req.body;

        const result = await bookCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updatedBook,
              updatedAt: new Date()
            },
          }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'Book not found' });
        }

        res.json(result);
      } catch (e) {
        res.status(500).json({
          message: 'Failed to update book',
          error: e.message,
        });
      }
    });


    // ── Delete single book ──
    // DELETE /books/:id
    app.delete('/books/:id', verifyToken, verifyLibrarian, async (req, res) => {
      try {
        const { id } = req.params;

        const result = await bookCollection.deleteOne({
          _id: new ObjectId(id),
        });

        if (result.deletedCount === 0) {
          return res.status(404).json({
            message: 'Book not found',
          });
        }

        res.json(result);
      } catch (e) {
        res.status(500).json({
          message: 'Failed to delete book',
          error: e.message,
        });
      }
    });


    // GET FEATURED-BOOKS
    app.get('/featured-books', async (req, res) => {
      try {
        const books = await bookCollection
          .find({ status: 'published' })
          .sort({ totalDeliveries: -1 })
          .limit(8)
          .toArray();
        console.log(books);
        res.json(books);
      } catch (e) {
        res.status(500).json({
          message: 'Failed to fetch featured books',
          error: e.message,
        });
      }
    });


    // GET /librarian/books/:librarianID
    app.get(
      '/librarian/books/:librarianID',
      verifyToken,
      verifyLibrarian,
      async (req, res) => {
        try {
          const page = parseInt(req.query.page) || 1;
          const limit = 10;
          const skip = (page - 1) * limit;

          const filter = {
            librarianId: req.user.id,
          };

          const totalBooks = await bookCollection.countDocuments(filter);

          const books = await bookCollection
            .find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

          res.json({
            books,
            totalPage: Math.ceil(totalBooks / limit),
            currentPage: page,
          });
        } catch (e) {
          res.status(500).json({
            message: 'Failed to fetch your books',
            error: e.message,
          });
        }
      }
    );


    // POST /librarian/books
    app.post('/librarian/books/:librarianID', verifyToken, verifyLibrarian, async (req, res) => {
      try {
        const book = {
          ...req.body,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const result = await bookCollection.insertOne(book);
        res.json(result);
      } catch (e) {
        res.status(500).json({ message: 'Failed to add book', error: e.message });
      }
    });


    // GET /librarian/deliveries  — deliveries for this librarian's books
    app.get('/librarian/deliveries/:librarianID', verifyToken, verifyLibrarian, async (req, res) => {
      try {
        const deliveries = await deliveryCollection
          .find({ librarianId: req.user.id })
          .sort({ requestedAt: -1 })
          .toArray();
        res.json({ success: true, deliveries, });
      } catch (e) {
        res.status(500).json({ message: 'Failed to fetch deliveries', error: e.message });
      }
    });


    // PATCH /librarian/deliveries/:id/status
    app.patch('/librarian/deliveries/:id/status', verifyToken, verifyLibrarian, async (req, res) => {
      try {
        const { status } = req.body;
        const allowed = ['pending', 'dispatched', 'delivered'];
        if (!allowed.includes(status)) {
          return res.status(400).json({ message: 'Invalid status value' });
        }

        const delivery = await deliveryCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!delivery) return res.status(404).json({ message: 'Delivery not found' });

        if (delivery.librarianId !== req.user.id) {
          return res.status(403).json({ message: 'You can only update your own deliveries' });
        }

        const result = await deliveryCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { deliveryStatus: status, updatedAt: new Date() } }
        );

        const { bookId } = req.body;

        if (status === 'delivered') {
          await bookCollection.updateOne(
            { _id: new ObjectId(bookId) },
            {
              $inc: {
                totalDeliveries: 1,
              },
            }
          );
        }

        res.json({ message: `Delivery status updated to ${status}`, result, });
      } catch (e) {
        res.status(500).json({ message: 'Failed to update delivery status', error: e.message });
      }
    });

    // ── Get reviews for a specific user ──
    // GET /user/reviews/:userId
    app.get('/user/reviews/:userId', verifyToken, async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find({ userId: req.user.id })
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ success: true, reviews, });
      } catch (e) {
        res.status(500).json({
          message: 'Failed to fetch reviews',
          error: e.message,
        });
      }
    });


    // ── Get reviews for a specific book ──
    // GET /reviews/:bookId
    app.get('/reviews/:bookId', async (req, res) => {
      try {
        const { bookId } = req.params;

        const reviews = await reviewsCollection
          .find({ bookId })
          .sort({ createdAt: -1 })
          .toArray();

        const avgResult = await reviewsCollection
          .aggregate([
            { $match: { bookId } },
            {
              $group: {
                _id: null,
                avgRating: { $avg: '$rating' },
              },
            },
          ])
          .toArray();

        const avgRating = avgResult.length
          ? Number(avgResult[0].avgRating.toFixed(1))
          : 0;

        res.json({
          reviews,
          avgRating,
        });
      } catch (e) {
        res.status(500).json({
          message: 'Failed to fetch reviews',
          error: e.message,
        });
      }
    });


    // ── Post a review — only if user has a "delivered" delivery for this book ──
    // POST /reviews
    app.post('/reviews', verifyToken, async (req, res) => {

      try {
        const { bookId, bookTitle, bookAuthor, coverImage, rating, user, comment } = req.body;

        // Check if already reviewed
        const alreadyReviewed = await reviewsCollection.findOne({
          bookId,
          userId: req.user.id,
        });

        if (alreadyReviewed) {
          return res.status(400).json({
            message: 'You have already reviewed this book',
          });
        }

        const review = {
          bookId,
          bookTitle,
          bookAuthor,
          coverImage,
          userId: req.user.id,
          user,
          rating: Number(rating),
          comment,
          createdAt: new Date(),
        };

        const result = await reviewsCollection.insertOne(review);

        res.json(result);
      } catch (e) {
        res.status(500).json({
          message: 'Failed to add review',
          error: e.message,
        });
      }
    });

    // ── Update a review ──
    // PATCH /reviews/:reviewId
    app.patch('/reviews/:reviewId', verifyToken, async (req, res) => {
      try {
        const { reviewId } = req.params;
        const { rating, comment } = req.body;

        const review = await reviewsCollection.findOne({
          _id: new ObjectId(reviewId),
        });

        if (!review) {
          return res.status(404).json({
            message: 'Review not found',
          });
        }

        if (review.userId !== req.user.id) {
          return res.status(403).json({
            message: 'You can only edit your own review',
          });
        }

        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(reviewId) },
          {
            $set: {
              rating: Number(rating),
              comment,
              updatedAt: new Date(),
            },
          }
        );

        res.json(result);
      } catch (e) {
        res.status(500).json({
          message: 'Failed to update review',
          error: e.message,
        });
      }
    });

    // ── Delete a review ──
    // DELETE /reviews/:reviewId
    app.delete('/reviews/:reviewId', verifyToken, async (req, res) => {
      try {
        const { reviewId } = req.params;

        const result = await reviewsCollection.deleteOne({
          _id: new ObjectId(reviewId),
        });

        res.json(result);
      } catch (e) {
        res.status(500).json({
          message: 'Failed to delete review',
          error: e.message,
        });
      }
    });


    // GET /librarian/transactions/:librarianID
    app.get('/librarian/transactions/:librarianID', verifyToken, verifyLibrarian, async (req, res) => {
      try {

        const transactions = await transactionCollection
          .find({ librarianId: req.user.id })
          .sort({ paidAt: -1 })
          .toArray();

        const totalEarnings = transactions.reduce(
          (sum, t) => sum + (Number(t.amount) || 0), 0
        );

        res.json({ totalEarnings, transactions });
      } catch (e) {
        res.status(500).json({ message: 'Failed to fetch transactions', error: e.message });
      }
    });



    // GET: DELIVERIES for users      -------------token verify
    app.get('/user/deliveries/:uid', verifyToken, async (req, res) => {
      try {
        const { uid } = req.params;

        const deliveries = await deliveryCollection
          .find({ userId: uid })
          .sort({ requestedAt: -1 })
          .toArray();

        res.json({
          totalDelivery: deliveries.length,
          deliveries,
        });
      } catch (e) {
        res.status(500).json({
          message: 'Failed to fetch deliveries',
          error: e.message,
        });
      }
    });

    // POST: DELIVERIES          --------------token verify needed
    app.post('/deliveries', async (req, res) => {
      try {
        const deliveryData = req.body;

        // Guard: if same Stripe session delivery already saved, skip insert
        const existing = await deliveryCollection.findOne({
          sessionId: deliveryData.sessionId
        });

        if (existing) {
          return res.json({ success: true, duplicate: true });
        }

        const result = await deliveryCollection.insertOne(deliveryData);
        res.json(result);

      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });



    // GET: TRANSACTIONS for users          --------------token verify
    app.get('/user/transactions/:uid', verifyToken, async (req, res) => {
      try {
        const { uid } = req.params;

        const transactions = await transactionCollection
          .find({ userId: uid })
          .sort({ paidAt: -1 })
          .toArray();

        const totalSpending = transactions.reduce(
          (sum, transaction) => sum + (Number(transaction.amount) || 0),
          0
        );

        res.json({
          totalSpending,
          transactions,
        });
      } catch (e) {
        res.status(500).json({
          message: 'Failed to fetch transactions',
          error: e.message,
        });
      }
    });


    // POST: TRANSACTION
    app.post('/transactions', async (req, res) => {
      try {
        const transaction = req.body;

        // Guard: if same Stripe session already saved, skip insert
        const existing = await transactionCollection.findOne({
          sessionId: transaction.sessionId
        });

        if (existing) {
          return res.json({ success: true, duplicate: true });
        }

        const result = await transactionCollection.insertOne(transaction);
        res.json(result);

      } catch (err) {
        res.status(500).json({ success: false, message: err.message });
      }
    });

  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}

run();


app.listen(port, () => {
  console.log('server is running on port ', port);
});
