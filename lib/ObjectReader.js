/**
 *Read json object from a data stream
 *Process data and emit 'object' with object.
 *
 */
var event;
var pd = "";
var isNumber = true;
var no = -1;
module.exports = function init(obj) {
	event = obj;
};

module.exports.prototype.addData = function addData(data) {
	data = data.toString('utf8');
	pd = processData(pd + data);
};

function processData(d) {
	if (isNumber) {
		if (d.indexOf(' ') != -1 ) {
			no = parseInt(d.substring(0, d.indexOf(' ')), 10);
			d = d.substring(d.indexOf(' ') + 1);
			isNumber = false;
		}
	}
	if(!isNumber) {
		if (d.length >= no) {
			event.emit('object', JSON.parse(d.substring(0, no)));
			d = d.substring(no);
			isNumber = true;
			if (d.length > 0) {
				return processData(d);
			}
			
		}
	}
	return d;
}