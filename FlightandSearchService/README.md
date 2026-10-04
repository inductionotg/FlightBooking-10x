# Welcome to Flights Service

## Project Setup
- clone the project on your local
- Execute `npm install` on the same path as of your root directory of the downloaded project
- Create a `.env` file in the root directory and add the following environment variable
    - `port=3000`
- Inside the `src/config` folder create a new file `config.json` and then add the following      piece of json

```
{
  "development": {
    "username": <YOUR DB_USERNAME>,
    "password": <YOUR DB_PASSWORD>,
    "database": "Flights_search_DB_DEV",
    "host": "127.0.0.1",
    "dialect": "mysql"
  }
}

```
- Once you have added your db config as listed above, go to the src folder from your terminal and execute `npx sequelize db:create` and then execute `npx sequelize db:migrate`.



## DB Design
- Airplane Table
- Flight
- Airport
- City

- A flight belongs to an airplane but one airplane can be used in multiple fights
- A city has many airports but one airport belongs to a city
- One airport can have many flights, but a flight belongs to one airport

## Tables
### City -> id,name,created_at, updated_at
### Airport -> id,names,address,city_id,creatde_At,updated_at
    RelationShip -> City has many airports and Airports belongs to a city( one to many)
```
npx:sequelize model:generate --name Airport --attributes name:String, address:String,cityId:integer
```

```
Try to sync DB atleast once after creating and changing Models. Sync DB every time is a very heavy Task and it runs hell lot of queries. So an easy process to sync DB is to add if condition in index.js rather than commenting or uncommenting everytime

### if Condition
    ```
    if(process.env.SYNC_DB){
            db.sequelize.sync({alter:true})
        }
    ```

Add SYNC_DB = true in .env file whenever you want to sync db 
```