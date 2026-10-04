const { StatusCodes} = require('http-status-codes');


class AppErrors extends Error {
    constructor(
        name = 'AppError', 
        message=' Something went Wrong', 
        explanation = 'Something went wrong', 
        statusCode=StatusCodes.INTERNAL_SERVER_ERROR
        )
        {
            super()
            this.message = message,
            this.name = name,
            this.explanation = explanation,
            this.statusCode = statusCode
            
        }
        
}
/*
class AppErrors extends Error {
    constructor(fullName = "fooName", lastName, canAccess = false) {
        this.fullName = fullName;
        this.lastName = lastName;
        this.canAccess = canAccess;
      }
}
*/
module.exports = AppErrors;