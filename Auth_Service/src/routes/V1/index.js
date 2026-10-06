const express = require('express')
const UserController = require('../../controllers/user-controller')
const router = express.Router()
const {validateUserAuth} = require('../../middlewares/auth-request-Middlewares')

router.post('/signup',UserController.create)
router.delete('/signup/:id',UserController.destroy)
router.get('/user/:id',UserController.getUser)
router.post('/signIn',validateUserAuth,UserController.signIn)
router.get('/isAuthenticated',UserController.isAuthenticated)
router.get('/isAdmin',UserController.isAdmin)
router.get('/me',UserController.me)
module.exports = router
