package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/RahulKraken/aftertrace/internal/plans"
)

func (s *Server) getSubscriptions(w http.ResponseWriter, r *http.Request) {
	subs, err := plans.List(s.db())
	if err != nil {
		s.err(w, err, 400)
		return
	}
	sum, err := plans.Compute(s.db(), time.Now())
	if err != nil {
		s.err(w, err, 400)
		return
	}
	s.json(w, map[string]any{
		"catalog":       plans.Catalog,
		"subscriptions": subs,
		"summary":       sum,
	}, 200)
}

func (s *Server) postSubscription(w http.ResponseWriter, r *http.Request) {
	var d plans.Draft
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		s.err(w, err, 400)
		return
	}
	var out plans.Subscription
	if err := s.Store.Mutate(func(tx *sql.Tx) error {
		var err error
		out, err = plans.Insert(tx, d, time.Now())
		return err
	}); err != nil {
		s.err(w, err, statusFor(err))
		return
	}
	s.json(w, out, 201)
}

func (s *Server) patchSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var d plans.Draft
	if err := json.NewDecoder(r.Body).Decode(&d); err != nil {
		s.err(w, err, 400)
		return
	}
	var out plans.Subscription
	if err := s.Store.Mutate(func(tx *sql.Tx) error {
		var err error
		out, err = plans.Update(tx, id, d, time.Now())
		return err
	}); err != nil {
		s.err(w, err, statusFor(err))
		return
	}
	s.json(w, out, 200)
}

func (s *Server) cancelSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var out plans.Subscription
	if err := s.Store.Mutate(func(tx *sql.Tx) error {
		var err error
		out, err = plans.Cancel(tx, id, time.Now())
		return err
	}); err != nil {
		s.err(w, err, statusFor(err))
		return
	}
	s.json(w, out, 200)
}

func (s *Server) restoreSubscription(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var out plans.Subscription
	if err := s.Store.Mutate(func(tx *sql.Tx) error {
		var err error
		out, err = plans.Restore(tx, id, time.Now())
		return err
	}); err != nil {
		s.err(w, err, statusFor(err))
		return
	}
	s.json(w, out, 200)
}

func statusFor(err error) int {
	if err != nil && err.Error() == "not found" {
		return 404
	}
	return 400
}
