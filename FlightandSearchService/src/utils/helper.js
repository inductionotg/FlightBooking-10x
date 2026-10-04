function compareTime(dateTime1,dateTime2){
    let TimeString1 = new Date(dateTime1)
    let TimeString2 = new Date(dateTime2)
    return TimeString1.getTime() > TimeString2.getTime()
 }


module.exports ={ compareTime }