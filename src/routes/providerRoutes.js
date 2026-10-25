const express = require('express');
const router = express.Router();
const { getNearbyProviders, getProviderById } = require('../controllers/providerController');

// Public endpoints to discover providers and view profiles
router.get('/nearby', getNearbyProviders);
router.get('/:id', getProviderById);

module.exports = router;
