/* jshint jquery: true */
/* global libsb, roomEl */
/* exported chatArea */

// var roomList = {};

$(function() {
	var $roomlist = $(".roomlist"),
		rooms = [];

	libsb.getRooms({}, function(err, r) {
//		console.log("Got rooms", r);
		if(err) throw err;
		rooms = rooms.concat(r);
		$roomlist.reset();
	});

	// Set up infinite scroll here.
	$roomlist.infinite({
		scrollSpace: 2000,
		fillSpace: 500,
		itemHeight: 100,
		startIndex: 0,
		getItems: function (index, before, after, recycle, callback) {
			var res = [], i;
			
			for(i=index-before; i<=index+after; i++) {
				if(i<0) { res.push(false); i=0; }
				if(i==index) continue;
				if(i>rooms.length-1) { res.push(false); break; }
				res.push(roomEl.render(null, rooms[i], i));
			}
			
			callback(res);
		}
	});
	
	// Set up a click listener.
	
	$roomlist.click(function(event) {
		var $el = $(event.target).closest(".roomitem");
		if(!$el.size()) return;
		libsb.emit('navigate', {room: $el.attr("id").split('-')[1] });
		event.preventDefault();
	});
});