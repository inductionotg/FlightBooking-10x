const path = require('path');
const fs = require('fs');
const handlebars = require('handlebars')
const filePath = path.join(__dirname, '../template.html');
const source = fs.readFileSync(filePath, 'utf-8').toString();
const template = handlebars.compile(source);
const replacements = {
    username: "Darth Vader"
};
const htmlToSend = template(replacements);

module.exports = htmlToSend