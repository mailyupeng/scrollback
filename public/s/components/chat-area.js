/* jshint jquery: true */
/* global libsb, renderChat */

$(function() {
	var $logs = $(".chat-area"),
		time = null; /* replace this with the time from the URL, if available. */

	$logs.infinite({
		scrollSpace: 2000,
		fillSpace: 500,
		itemHeight: 50,
		startIndex: time,
		getItems: function (index, before, after, callback) {
			libsb.getTexts({time: index, before: before, after: after}, function(err, texts) {
				if(err) throw err; // TODO: handle the error properly.

				callback(texts.map(function(text) {
					return text && renderChat(null, text);
				}));
			});
		}
	});

	libsb.on('text-dn', function(text, next) {
		if($logs.data("lower-limit"))
			$("#logs").addBelow(renderChat(null, text));
		next();
	});


	// --- add classes to body to reflect state ---

	var timeout,
		top = $(this).scrollTop();

	$(".chat-area").on("scroll", function() {
		var cur_top = $(this).scrollTop();

		if (top < cur_top) {
			$("body").removeClass("scroll-up").addClass("scroll-down");
		} else {
			$("body").removeClass("scroll-down").addClass("scroll-up");
		}

		top = cur_top;

		$("body").addClass("scrolling");

		if(timeout) clearTimeout(timeout);

		timeout = setTimeout(function(){
			$("body").removeClass("scrolling").removeClass("scroll-up").removeClass("scroll-down");
			timeout = 0;
		}, 1000);
	});
});

